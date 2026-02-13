import { createHash } from "crypto";
import type { Logger } from "@/server/lib/logger";
import { getBaselineSkill } from "@/server/features/ai/skills/registry/baseline-registry";
import { baselineSkills } from "@/server/features/ai/skills/baseline";
import { routeSkill } from "@/server/features/ai/skills/router/route-skill";
import { resolveSlots } from "@/server/features/ai/skills/slots/resolve-slots";
import { executeSkill } from "@/server/features/ai/skills/executor/execute-skill";
import { EXECUTOR_SUPPORTED_CAPABILITIES } from "@/server/features/ai/skills/executor/execute-skill";
import { createCapabilities } from "@/server/features/ai/capabilities";
import { emitSkillTelemetry } from "@/server/features/ai/skills/telemetry/emit";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
import { loadSkillPolicyContext } from "@/server/features/ai/skills/policy/context";
import type { SkillId } from "@/server/features/ai/skills/baseline/skill-ids";

type ExecuteOutcome =
  | {
      kind: "clarify";
      text: string;
      interactivePayloads: unknown[];
      approvals: Array<{ id: string; requestPayload?: unknown }>;
      status: "blocked";
      diagnosticsCode?: string;
      diagnosticsCategory?: string;
    }
  | {
      kind: "executed";
      text: string;
      interactivePayloads: unknown[];
      approvals: Array<{ id: string; requestPayload?: unknown }>;
      status: "success" | "partial" | "blocked" | "failed";
      diagnosticsCode?: string;
      diagnosticsCategory?: string;
    };

let capabilityCoverageChecked = false;

function assertBaselineSkillCapabilitiesSupported(): void {
  if (capabilityCoverageChecked) return;
  const unsupported: string[] = [];
  for (const skill of baselineSkills) {
    for (const step of skill.plan) {
      if (!step.capability) continue;
      if (!EXECUTOR_SUPPORTED_CAPABILITIES.has(step.capability)) {
        unsupported.push(`${skill.id}:${step.id}:${step.capability}`);
      }
    }
  }
  if (unsupported.length > 0) {
    throw new Error(
      `unsupported_skill_capabilities:${unsupported.join(",")}`,
    );
  }
  capabilityCoverageChecked = true;
}

function emitRouteTelemetry(params: {
  logger: Logger;
  requestId: string;
  provider: string;
  route: Awaited<ReturnType<typeof routeSkill>>;
  finalOutcome?: string;
}): void {
  emitSkillTelemetry(params.logger, {
    name: "skill.route.completed",
    requestId: params.requestId,
    provider: params.provider,
    skillId: params.route.skillId,
    confidence: params.route.confidence,
    reason: params.route.reason,
    semanticParseConfidence: params.route.semanticParseConfidence,
    routedFamilies: params.route.routedFamilies,
    unresolvedEntities: params.route.unresolvedEntities,
    ...(params.finalOutcome ? { finalOutcome: params.finalOutcome } : {}),
  });
}

function emitExecutionTelemetry(params: {
  logger: Logger;
  requestId: string;
  provider: string;
  skillId: SkillId;
  result: Awaited<ReturnType<typeof executeSkill>>;
}): void {
  emitSkillTelemetry(params.logger, {
    name: "skill.execution.completed",
    requestId: params.requestId,
    provider: params.provider,
    skillId: params.skillId,
    status: params.result.status,
    stepsExecuted: params.result.stepsExecuted,
    stepGraphSize: params.result.stepGraphSize,
    toolChain: params.result.toolChain,
    capabilityChain: params.result.toolChain,
    stepDurationsMs: params.result.stepDurationsMs,
    postconditionsPassed: params.result.postconditionsPassed,
    postconditionPassRate: params.result.postconditionsPassed ? 1 : 0,
    policyBlockCount: params.result.policyBlockCount,
    repairAttemptCount: params.result.repairAttemptCount,
    finalOutcome: params.result.status,
    ...(params.result.diagnostics?.code ? { diagnosticsCode: params.result.diagnostics.code } : {}),
    ...(params.result.diagnostics?.category
      ? { diagnosticsCategory: params.result.diagnostics.category }
      : {}),
    ...(params.result.failureReason ? { failureReason: params.result.failureReason } : {}),
  });
}

export async function runBaselineSkillTurn(params: {
  provider: string;
  userId: string;
  emailAccountId: string;
  email: string;
  providerName: string;
  message: string;
  logger: Logger;
  conversationId?: string;
  channelId?: string;
  threadId?: string;
  messageId?: string;
  teamId?: string;
  sourceEmailMessageId?: string;
  sourceEmailThreadId?: string;
  sourceCalendarEventId?: string;
}): Promise<
  | { kind: "clarify"; text: string }
  | {
      kind: "executed";
      text: string;
      interactivePayloads: unknown[];
      approvals: Array<{ id: string; requestPayload?: unknown }>;
      debug: {
        skillId: string;
        status: string;
        diagnosticsCode?: string;
        diagnosticsCategory?: string;
      };
    }
> {
  assertBaselineSkillCapabilitiesSupported();

  const requestId = createHash("sha256")
    .update(`${params.userId}:${params.provider}:${Date.now()}:${params.message}`)
    .digest("hex")
    .slice(0, 16);

  const tz = await resolveDefaultCalendarTimeZone({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
  });
  const timeZone = "timeZone" in tz ? tz.timeZone : "UTC";
  const policyContext = await loadSkillPolicyContext(params.userId);
  const capabilities = await createCapabilities({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    email: params.email,
    provider: params.providerName,
    logger: params.logger,
    conversationId: params.conversationId,
    currentMessage: params.message,
    sourceEmailMessageId: params.sourceEmailMessageId,
    sourceEmailThreadId: params.sourceEmailThreadId,
  });

  const route = await routeSkill({
    message: params.message,
    logger: params.logger,
    emailAccount: { id: params.emailAccountId, email: params.email, userId: params.userId },
  });
  emitRouteTelemetry({
    logger: params.logger,
    requestId,
    provider: params.provider,
    route,
  });

  if (!route.skillId) {
    return { kind: "clarify", text: route.clarificationPrompt ?? "What would you like to do?" };
  }

  if (route.skillId === "multi_action_inbox_calendar") {
    const composite = await executeSingleSkill({
      requestId,
      routeSkillId: route.skillId,
      message: params.message,
      provider: params.provider,
      logger: params.logger,
      userId: params.userId,
      emailAccount: { id: params.emailAccountId, email: params.email, userId: params.userId },
      timeZone,
      capabilities,
      policyContext,
      conversationId: params.conversationId,
      channelId: params.channelId,
      threadId: params.threadId,
      messageId: params.messageId,
      teamId: params.teamId,
      sourceEmailMessageId: params.sourceEmailMessageId,
      sourceEmailThreadId: params.sourceEmailThreadId,
      sourceCalendarEventId: params.sourceCalendarEventId,
    });

    if (composite.kind === "clarify") {
      return { kind: "clarify", text: composite.text };
    }

    const parsed = await resolveSlots(getBaselineSkill("multi_action_inbox_calendar"), params.message, {
      logger: params.logger,
      emailAccount: { id: params.emailAccountId, email: params.email, userId: params.userId },
      timeZone,
      sourceEmailMessageId: params.sourceEmailMessageId,
      sourceEmailThreadId: params.sourceEmailThreadId,
      sourceCalendarEventId: params.sourceCalendarEventId,
    });
    const actions = Array.isArray(parsed.resolved.composite_actions)
      ? (parsed.resolved.composite_actions as string[]).filter((part) => part.trim().length > 0)
      : [];

    if (actions.length === 0) {
      return {
        kind: "clarify",
        text: "I need each action spelled out. Example: 'archive newsletters and reschedule tomorrow standup'.",
      };
    }

    const actionResults: Array<{
      action: string;
      status: string;
      text: string;
      payloads: unknown[];
      approvals: Array<{ id: string; requestPayload?: unknown }>;
    }> = [];
    for (let i = 0; i < Math.min(actions.length, 6); i += 1) {
      const actionText = actions[i]!;
      const subRequestId = `${requestId}-a${i + 1}`;
      const actionRoute = await routeSkill({
        message: actionText,
        logger: params.logger,
        emailAccount: { id: params.emailAccountId, email: params.email, userId: params.userId },
      });
      emitRouteTelemetry({
        logger: params.logger,
        requestId: subRequestId,
        provider: params.provider,
        route: actionRoute,
      });

      if (!actionRoute.skillId || actionRoute.skillId === "multi_action_inbox_calendar") {
        actionResults.push({
          action: actionText,
          status: "blocked",
          text:
            actionRoute.clarificationPrompt ??
            "I couldn't safely map this sub-action. Please make it more specific.",
          payloads: [],
          approvals: [],
        });
        continue;
      }

      const actionOutcome = await executeSingleSkill({
        requestId: subRequestId,
        routeSkillId: actionRoute.skillId,
        message: actionText,
        provider: params.provider,
        logger: params.logger,
        userId: params.userId,
        emailAccount: { id: params.emailAccountId, email: params.email, userId: params.userId },
        timeZone,
        capabilities,
        policyContext,
        conversationId: params.conversationId,
        channelId: params.channelId,
        threadId: params.threadId,
        messageId: params.messageId,
        teamId: params.teamId,
        sourceEmailMessageId: params.sourceEmailMessageId,
        sourceEmailThreadId: params.sourceEmailThreadId,
        sourceCalendarEventId: params.sourceCalendarEventId,
      });

      actionResults.push({
        action: actionText,
        status: actionOutcome.status,
        text: actionOutcome.text,
        payloads: actionOutcome.interactivePayloads,
        approvals: actionOutcome.approvals,
      });
    }

    const finalStatus = actionResults.every((r) => r.status === "success")
      ? "success"
      : actionResults.some((r) => r.status === "success")
        ? "partial"
        : "blocked";

    const interactivePayloads = actionResults.flatMap((r) => r.payloads);
    const approvals = actionResults.flatMap((r) => r.approvals);
    const lines = actionResults.map(
      (r, idx) => `${idx + 1}. ${r.action}\n   - ${r.text}`,
    );

    return {
      kind: "executed",
      text: lines.join("\n"),
      interactivePayloads,
      approvals,
      debug: { skillId: route.skillId, status: finalStatus },
    };
  }

  const outcome = await executeSingleSkill({
    requestId,
    routeSkillId: route.skillId,
    message: params.message,
    provider: params.provider,
    logger: params.logger,
    userId: params.userId,
    emailAccount: { id: params.emailAccountId, email: params.email, userId: params.userId },
    timeZone,
    capabilities,
    policyContext,
    conversationId: params.conversationId,
    channelId: params.channelId,
    threadId: params.threadId,
    messageId: params.messageId,
    teamId: params.teamId,
    sourceEmailMessageId: params.sourceEmailMessageId,
    sourceEmailThreadId: params.sourceEmailThreadId,
    sourceCalendarEventId: params.sourceCalendarEventId,
  });

  if (outcome.kind === "clarify") return { kind: "clarify", text: outcome.text };

  return {
    kind: "executed",
    text: outcome.text,
    interactivePayloads: outcome.interactivePayloads,
    approvals: outcome.approvals,
    debug: {
      skillId: route.skillId,
      status: outcome.status,
      ...(outcome.diagnosticsCode ? { diagnosticsCode: outcome.diagnosticsCode } : {}),
      ...(outcome.diagnosticsCategory
        ? { diagnosticsCategory: outcome.diagnosticsCategory }
        : {}),
    },
  };
}

async function executeSingleSkill(params: {
  requestId: string;
  routeSkillId: SkillId;
  message: string;
  provider: string;
  logger: Logger;
  userId: string;
  emailAccount: { id: string; email: string; userId: string };
  timeZone: string;
  capabilities: Awaited<ReturnType<typeof createCapabilities>>;
  policyContext: Awaited<ReturnType<typeof loadSkillPolicyContext>>;
  conversationId?: string;
  channelId?: string;
  threadId?: string;
  messageId?: string;
  teamId?: string;
  sourceEmailMessageId?: string;
  sourceEmailThreadId?: string;
  sourceCalendarEventId?: string;
}): Promise<ExecuteOutcome> {
  const skill = getBaselineSkill(params.routeSkillId);
  const slots = await resolveSlots(skill, params.message, {
    logger: params.logger,
    emailAccount: params.emailAccount,
    timeZone: params.timeZone,
    sourceEmailMessageId: params.sourceEmailMessageId,
    sourceEmailThreadId: params.sourceEmailThreadId,
    sourceCalendarEventId: params.sourceCalendarEventId,
  });

  emitSkillTelemetry(params.logger, {
    name: "skill.slot_resolution.completed",
    requestId: params.requestId,
    provider: params.provider,
    skillId: params.routeSkillId,
    missingRequired: slots.missingRequired.length,
    ambiguous: slots.ambiguous.length,
    missingRequiredSlots: slots.missingRequired,
    ambiguousSlots: slots.ambiguous,
    ...(slots.clarificationPrompt ? { clarificationPrompt: slots.clarificationPrompt } : {}),
  });

  if (slots.missingRequired.length > 0) {
    return {
      kind: "clarify",
      text: slots.clarificationPrompt ?? "I need one more detail to continue.",
      interactivePayloads: [],
      approvals: [],
      status: "blocked",
      diagnosticsCode: "missing_required_slots",
      diagnosticsCategory: "missing_context",
    };
  }

  const result = await executeSkill({
    skill,
    slots,
    capabilities: params.capabilities,
    runtime: {
      logger: params.logger,
      emailAccount: params.emailAccount,
      policyContext: params.policyContext,
      approvalContext: {
        provider: params.provider,
        conversationId: params.conversationId,
        channelId: params.channelId,
        threadId: params.threadId,
        messageId: params.messageId,
        teamId: params.teamId,
        sourceEmailMessageId: params.sourceEmailMessageId,
        sourceEmailThreadId: params.sourceEmailThreadId,
        sourceCalendarEventId: params.sourceCalendarEventId,
      },
    },
  });

  emitExecutionTelemetry({
    logger: params.logger,
    requestId: params.requestId,
    provider: params.provider,
    skillId: params.routeSkillId,
    result,
  });

  for (const event of result.actionEvents) {
    emitSkillTelemetry(params.logger, {
      name: "skill.action.completed",
      requestId: params.requestId,
      provider: params.provider,
      userId: params.userId,
      skillId: params.routeSkillId,
      capability: event.capability,
      stepId: event.stepId,
      success: event.success,
      policyDecision: event.policyDecision,
      itemCount: event.itemCount,
      ...(event.errorCode ? { errorCode: event.errorCode } : {}),
    });
  }

  return {
    kind: "executed",
    text: result.responseText,
    interactivePayloads: result.interactivePayloads,
    approvals: Array.isArray(result.approvals) ? result.approvals : [],
    status: result.status,
    diagnosticsCode: result.diagnostics.code,
    diagnosticsCategory: result.diagnostics.category,
  };
}
