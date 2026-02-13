import { createHash } from "crypto";
import prisma from "@/server/db/client";
import { env } from "@/env";
import type { SkillCapabilities } from "@/server/features/ai/capabilities";
import type { PlannerExecutionResult, PlannerPlan } from "@/server/features/ai/planner/types";
import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import { executeWithRepair } from "@/server/features/ai/skills/executor/repair";
import { resolvePolicyConflict } from "@/server/features/ai/skills/policy/conflict-resolver";
import { ApprovalService, getApprovalExpiry } from "@/server/features/approvals/service";
import { createApprovalActionToken } from "@/server/features/approvals/action-token";
import { invokeCapability } from "@/server/features/ai/planner/invoke-capability";
import { mapPlannerCapabilityToApprovalContext } from "@/server/features/ai/planner/policy-context";
import type { Logger } from "@/server/lib/logger";
import { evaluatePolicyDecision } from "@/server/features/policy-plane/pdp";
import { createPolicyExecutionLog } from "@/server/features/policy-plane/policy-logs";

function topologicalSort(plan: PlannerPlan): string[] {
  const deps = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();

  for (const step of plan.steps) {
    deps.set(step.id, new Set(step.dependsOn ?? []));
    reverse.set(step.id, new Set());
  }
  for (const step of plan.steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!reverse.has(dep)) continue;
      reverse.get(dep)!.add(step.id);
    }
  }

  const queue: string[] = [];
  for (const [id, depSet] of deps.entries()) {
    if (depSet.size === 0) queue.push(id);
  }

  const out: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    for (const next of reverse.get(id) ?? []) {
      const nextDeps = deps.get(next);
      if (!nextDeps) continue;
      nextDeps.delete(id);
      if (nextDeps.size === 0) queue.push(next);
    }
  }

  return out.length === plan.steps.length
    ? out
    : plan.steps.map((step) => step.id);
}

function resolveTemplateString(
  value: string,
  outputs: Record<string, unknown>,
): unknown {
  const match = value.match(/^\{\{\s*([a-zA-Z0-9_-]+)(?:\.([a-zA-Z0-9_.-]+))?\s*\}\}$/u);
  if (!match) return value;
  const stepId = match[1]!;
  const path = match[2];
  let current: unknown = outputs[stepId];
  if (!path || path.trim().length === 0) return current;
  for (const key of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function resolveTemplates(value: unknown, outputs: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    return resolveTemplateString(value, outputs);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplates(item, outputs));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(obj)) {
      out[key] = resolveTemplates(item, outputs);
    }
    return out;
  }
  return value;
}

function buildApprovalActionUrl(params: {
  approvalId: string;
  action: "approve" | "deny";
}): string {
  const token = createApprovalActionToken({
    approvalId: params.approvalId,
    action: params.action,
  });
  const path =
    params.action === "approve"
      ? `/approvals/${params.approvalId}`
      : `/approvals/${params.approvalId}/deny`;
  return `${env.NEXT_PUBLIC_BASE_URL}${path}?token=${token}`;
}

function buildApprovalPayload(params: { approvalId: string; summary: string }) {
  let approveUrl: string | undefined;
  let denyUrl: string | undefined;

  try {
    approveUrl = buildApprovalActionUrl({
      approvalId: params.approvalId,
      action: "approve",
    });
    denyUrl = buildApprovalActionUrl({
      approvalId: params.approvalId,
      action: "deny",
    });
  } catch {
    // no-op
  }

  return {
    type: "approval_request" as const,
    approvalId: params.approvalId,
    summary: params.summary,
    actions: [
      { label: "Approve", style: "primary" as const, value: "approve", ...(approveUrl ? { url: approveUrl } : {}) },
      { label: "Deny", style: "danger" as const, value: "deny", ...(denyUrl ? { url: denyUrl } : {}) },
    ],
  };
}

function asItemCount(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    if (typeof (data as Record<string, unknown>).count === "number") {
      return (data as Record<string, unknown>).count as number;
    }
    if (Array.isArray((data as Record<string, unknown>).items)) {
      return ((data as Record<string, unknown>).items as unknown[]).length;
    }
  }
  return 0;
}

function asObjectArray(data: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function renderPlannerReadAnswer(params: {
  capability: CapabilityName;
  data: unknown;
}): string | null {
  if (
    params.capability === "email.searchInbox" ||
    params.capability === "email.searchThreads" ||
    params.capability === "email.searchThreadsAdvanced" ||
    params.capability === "email.searchSent"
  ) {
    const items = asObjectArray(params.data);
    const first = items[0];
    if (!first) return "I couldn't find matching emails.";
    const title =
      typeof first.title === "string" && first.title.trim().length > 0
        ? first.title.trim()
        : "(No Subject)";
    const from =
      typeof first.from === "string" && first.from.trim().length > 0
        ? first.from.trim()
        : "unknown sender";
    const date =
      typeof first.date === "string" && first.date.trim().length > 0
        ? first.date.trim()
        : "unknown time";
    return `The top matching inbox email is "${title}" from ${from} at ${date}.`;
  }

  if (
    params.capability === "calendar.listEvents" ||
    params.capability === "calendar.searchEventsByAttendee"
  ) {
    const items = asObjectArray(params.data);
    const first = items[0];
    if (!first) return "I couldn't find matching calendar events.";
    const title =
      typeof first.title === "string" && first.title.trim().length > 0
        ? first.title.trim()
        : "(Untitled event)";
    const start =
      typeof first.start === "string" && first.start.trim().length > 0
        ? first.start.trim()
        : "unknown time";
    return `The next matching event is "${title}" at ${start}.`;
  }

  return null;
}

function renderPlannerActionSummary(params: {
  stepResults: PlannerExecutionResult["stepResults"];
}): string {
  const successful = params.stepResults.filter((step) => step.success);
  const failed = params.stepResults.filter((step) => !step.success);
  const lines: string[] = [];
  lines.push(
    `Completed ${successful.length} step${successful.length === 1 ? "" : "s"}${
      failed.length > 0
        ? `, with ${failed.length} failure${failed.length === 1 ? "" : "s"}`
        : ""
    }.`,
  );
  for (const step of successful.slice(0, 5)) {
    const summary = step.message?.trim();
    if (summary) {
      lines.push(`- ${summary}`);
    } else {
      lines.push(`- Executed ${step.capability}.`);
    }
  }
  return lines.join("\n");
}

function isReadOnly(capability: CapabilityName): boolean {
  if (capability.startsWith("email.search")) return true;
  if (capability === "email.getThreadMessages") return true;
  if (capability === "email.getMessagesBatch") return true;
  if (capability === "email.getLatestMessage") return true;
  if (capability === "email.listFilters") return true;
  if (capability === "email.listDrafts") return true;
  if (capability === "email.getDraft") return true;
  if (capability === "calendar.findAvailability") return true;
  if (capability === "calendar.listEvents") return true;
  if (capability === "calendar.searchEventsByAttendee") return true;
  if (capability === "calendar.getEvent") return true;
  if (capability.startsWith("planner.")) return true;
  if (capability === "policy.listRules") return true;
  if (capability === "policy.compileRule") return true;
  return false;
}

async function logPlannerExecution(params: {
  userId: string;
  emailAccountId: string;
  source: "planner";
  capability: CapabilityName;
  args: Record<string, unknown>;
  outcome: "executed" | "deferred_approval" | "blocked" | "failed";
  result?: Record<string, unknown>;
  error?: string;
  context?: {
    conversationId?: string;
    channelId?: string;
    threadId?: string;
    messageId?: string;
  };
}) {
  try {
    const mapped = mapPlannerCapabilityToApprovalContext({
      capability: params.capability,
      args: params.args,
    });
    await createPolicyExecutionLog({
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      source: params.source,
      toolName: params.capability,
      mutationResource:
        typeof mapped.args.resource === "string" ? mapped.args.resource : undefined,
      mutationOperation:
        typeof mapped.args.operation === "string" ? mapped.args.operation : undefined,
      args: mapped.args,
      outcome: params.outcome,
      result: params.result,
      error: params.error,
      conversationId: params.context?.conversationId,
      channelId: params.context?.channelId,
      threadId: params.context?.threadId,
      messageId: params.context?.messageId,
    });
  } catch {
    // execution logging must never block planner execution.
  }
}

export async function executePlannerPlan(params: {
  plan: PlannerPlan;
  capabilities: SkillCapabilities;
  userId: string;
  emailAccountId: string;
  provider: string;
  logger: Logger;
  context?: {
    conversationId?: string;
    channelId?: string;
    threadId?: string;
    messageId?: string;
    teamId?: string;
    sourceEmailMessageId?: string;
    sourceEmailThreadId?: string;
    sourceCalendarEventId?: string;
  };
  maxAttemptsPerStep?: number;
}): Promise<PlannerExecutionResult> {
  const stepById = new Map(params.plan.steps.map((step) => [step.id, step] as const));
  const order = topologicalSort(params.plan);
  const stepOutputs: Record<string, unknown> = {};
  const stepResults: PlannerExecutionResult["stepResults"] = [];
  const interactivePayloads: unknown[] = [];
  const approvals: Array<{ id: string; requestPayload?: unknown }> = [];

  for (const stepId of order) {
    const step = stepById.get(stepId);
    if (!step) continue;

    const resolvedArgs = resolveTemplates(step.args, stepOutputs);
    let args =
      resolvedArgs && typeof resolvedArgs === "object" && !Array.isArray(resolvedArgs)
        ? (resolvedArgs as Record<string, unknown>)
        : {};

    if (!isReadOnly(step.capability)) {
      const policyContext = mapPlannerCapabilityToApprovalContext({
        capability: step.capability,
        args,
      });
      const policyDecision = await evaluatePolicyDecision({
        userId: params.userId,
        emailAccountId: params.emailAccountId,
        toolName: policyContext.toolName,
        args: policyContext.args,
        rawArgs: args,
        context: {
          source: "planner",
          provider:
            params.provider === "web" ||
            params.provider === "slack" ||
            params.provider === "discord" ||
            params.provider === "telegram"
              ? params.provider
              : "system",
          conversationId: params.context?.conversationId,
          channelId: params.context?.channelId,
          threadId: params.context?.threadId,
          messageId: params.context?.messageId,
        },
      });
      const approvalDecision = policyDecision.approval;
      if (policyDecision.kind === "block") {
        await logPlannerExecution({
          userId: params.userId,
          emailAccountId: params.emailAccountId,
          source: "planner",
          capability: step.capability,
          args,
          outcome: "blocked",
          error: policyDecision.message,
          context: params.context,
        });
        stepResults.push({
          stepId,
          capability: step.capability,
          success: false,
          policyBlocked: true,
          errorCode: policyDecision.reasonCode,
          message: policyDecision.message,
        });
        return {
          status: "blocked",
          responseText: policyDecision.message,
          approvals,
          interactivePayloads,
          stepResults,
          diagnosticsCode: policyDecision.reasonCode,
          diagnosticsCategory: "policy",
        };
      }
      if (policyDecision.kind === "require_approval" && approvalDecision?.requiresApproval) {
        const conflict = resolvePolicyConflict({
          capability: step.capability,
          approval: approvalDecision,
        });
        const requestPayload = {
          actionType: "planner_execution_step",
          description: conflict.userMessage,
          planGoal: params.plan.goal,
          stepId,
          capability: step.capability,
          args,
          emailAccountId: params.emailAccountId,
          conversationId: params.context?.conversationId,
          threadId: params.context?.threadId,
          messageId: params.context?.messageId,
          sourceEmailMessageId: params.context?.sourceEmailMessageId,
          sourceEmailThreadId: params.context?.sourceEmailThreadId,
          sourceCalendarEventId: params.context?.sourceCalendarEventId,
          resume: {
            executionState: {
              stepOutputs,
              blockedStepId: stepId,
            },
          },
        };
        const fingerprint = createHash("sha256")
          .update(
            JSON.stringify({
              userId: params.userId,
              emailAccountId: params.emailAccountId,
              planGoal: params.plan.goal,
              stepId,
              capability: step.capability,
              args,
            }),
          )
          .digest("hex");
        const approvalService = new ApprovalService(prisma);
        const expiresInSeconds = await getApprovalExpiry(params.userId);
        const approvalRequest = await approvalService.createRequest({
          userId: params.userId,
          provider: params.provider,
          externalContext: {
            conversationId: params.context?.conversationId,
            channelId: params.context?.channelId,
            threadId: params.context?.threadId,
            messageId: params.context?.messageId,
            workspaceId: params.context?.teamId,
          },
          requestPayload,
          idempotencyKey: `planner-approval:${params.userId}:${fingerprint}`,
          expiresInSeconds,
        });

        approvals.push({
          id: approvalRequest.id,
          requestPayload,
        });
        await logPlannerExecution({
          userId: params.userId,
          emailAccountId: params.emailAccountId,
          source: "planner",
          capability: step.capability,
          args,
          outcome: "deferred_approval",
          result: { approvalRequestId: approvalRequest.id },
          context: params.context,
        });
        interactivePayloads.push(
          buildApprovalPayload({
            approvalId: approvalRequest.id,
            summary: conflict.userMessage,
          }),
        );
        stepResults.push({
          stepId,
          capability: step.capability,
          success: false,
          policyBlocked: true,
          errorCode: "approval_required",
          message: conflict.userMessage,
        });
        return {
          status: "blocked",
          responseText: conflict.userMessage,
          approvals,
          interactivePayloads,
          stepResults,
          diagnosticsCode: "approval_required",
          diagnosticsCategory: "policy",
        };
      }
      if (
        policyDecision.kind === "allow_with_transform" &&
        policyDecision.transformedArgs &&
        typeof policyDecision.transformedArgs === "object"
      ) {
        args = policyDecision.transformedArgs;
      }
    }

    const { result } = await executeWithRepair(
      () =>
        invokeCapability({
          capability: step.capability,
          args,
          capabilities: params.capabilities,
        }),
      {
        maxAttempts: params.maxAttemptsPerStep ?? 3,
        baseDelayMs: 300,
      },
    );

    if (!result.success) {
      if (!isReadOnly(step.capability)) {
        await logPlannerExecution({
          userId: params.userId,
          emailAccountId: params.emailAccountId,
          source: "planner",
          capability: step.capability,
          args,
          outcome: "failed",
          error: result.error ?? result.message ?? "capability_failed",
          context: params.context,
        });
      }
      if (result.clarification?.prompt) {
        stepResults.push({
          stepId,
          capability: step.capability,
          success: false,
          message: result.clarification.prompt,
          errorCode: "clarification_required",
        });
        return {
          status: "blocked",
          responseText: result.message ?? result.clarification.prompt,
          approvals,
          interactivePayloads,
          stepResults,
          clarificationPrompt: result.clarification.prompt,
          missingFields: result.clarification.missingFields,
          diagnosticsCode: "missing_required_args",
          diagnosticsCategory: "missing_context",
        };
      }

      const error = result.error ?? "capability_failed";
      stepResults.push({
        stepId,
        capability: step.capability,
        success: false,
        errorCode: error,
        message: result.message,
      });
      return {
        status: stepResults.some((entry) => entry.success) ? "partial" : "failed",
        responseText:
          result.message ??
          `I couldn't complete step "${stepId}" (${step.capability}).`,
        approvals,
        interactivePayloads,
        stepResults,
        diagnosticsCode: error,
        diagnosticsCategory: "provider",
      };
    }

    stepOutputs[stepId] = result.data ?? null;
    if (!isReadOnly(step.capability)) {
      await logPlannerExecution({
        userId: params.userId,
        emailAccountId: params.emailAccountId,
        source: "planner",
        capability: step.capability,
        args,
        outcome: "executed",
        result:
          result.data && typeof result.data === "object"
            ? (result.data as Record<string, unknown>)
            : { value: result.data ?? null },
        context: params.context,
      });
    }
    stepResults.push({
      stepId,
      capability: step.capability,
      success: true,
      message: result.message,
      itemCount: asItemCount(result.data),
    });
  }

  const successfulReadStep = stepResults.find(
    (step) => step.success && isReadOnly(step.capability),
  );
  const readAnswer =
    successfulReadStep != null
      ? renderPlannerReadAnswer({
          capability: successfulReadStep.capability,
          data: stepOutputs[successfulReadStep.stepId],
        })
      : null;
  return {
    status: "success",
    responseText:
      readAnswer ??
      renderPlannerActionSummary({
        stepResults,
      }),
    approvals,
    interactivePayloads,
    stepResults,
  };
}
