import { createHash } from "crypto";
import prisma from "@/server/db/client";
import { env } from "@/env";
import type { SkillCapabilities } from "@/server/features/ai/capabilities";
import type { PlannerExecutionResult, PlannerPlan } from "@/server/features/ai/planner/types";
import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import { executeWithRepair } from "@/server/features/ai/skills/executor/repair";
import { evaluateApprovalRequirement } from "@/server/features/approvals/rules";
import { resolvePolicyConflict } from "@/server/features/ai/skills/policy/conflict-resolver";
import { ApprovalService, getApprovalExpiry } from "@/server/features/approvals/service";
import { createApprovalActionToken } from "@/server/features/approvals/action-token";
import { invokeCapability } from "@/server/features/ai/planner/invoke-capability";
import { mapPlannerCapabilityToApprovalContext } from "@/server/features/ai/planner/policy-context";
import type { Logger } from "@/server/lib/logger";

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
  return false;
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
    const args =
      resolvedArgs && typeof resolvedArgs === "object" && !Array.isArray(resolvedArgs)
        ? (resolvedArgs as Record<string, unknown>)
        : {};

    if (!isReadOnly(step.capability)) {
      const policyContext = mapPlannerCapabilityToApprovalContext({
        capability: step.capability,
        args,
      });
      const approvalDecision = await evaluateApprovalRequirement({
        userId: params.userId,
        toolName: policyContext.toolName,
        args: policyContext.args,
      });
      if (approvalDecision.requiresApproval) {
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
    stepResults.push({
      stepId,
      capability: step.capability,
      success: true,
      message: result.message,
      itemCount: asItemCount(result.data),
    });
  }

  const summaryLines = stepResults.map((step, index) => {
    const status = step.success ? "done" : "failed";
    const base = `${index + 1}. [${status}] ${step.capability}`;
    return step.message ? `${base}\n   - ${step.message}` : base;
  });
  return {
    status: "success",
    responseText:
      summaryLines.length > 0
        ? summaryLines.join("\n")
        : "Done.",
    approvals,
    interactivePayloads,
    stepResults,
  };
}
