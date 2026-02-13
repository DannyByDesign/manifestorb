import type { Logger } from "@/server/lib/logger";
import type { SkillCapabilities } from "@/server/features/ai/capabilities";
import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import { buildPlannerPlan } from "@/server/features/ai/planner/build-plan";
import { repairPlannerPlan } from "@/server/features/ai/planner/repair-plan";
import { validatePlannerPlan } from "@/server/features/ai/planner/validate-plan";
import { executePlannerPlan } from "@/server/features/ai/planner/execute-plan";
import { emitSkillTelemetry } from "@/server/features/ai/skills/telemetry/emit";
import { selectCandidateCapabilities } from "@/server/features/ai/planner/select-capabilities";
import type { PlannerPlan } from "@/server/features/ai/planner/types";

export interface PlannerContinuationState {
  baseMessage: string;
  candidateCapabilities: CapabilityName[];
  clarificationPrompt?: string;
  missingFields?: string[];
}

const PLAN_BUILD_FAILURE_MESSAGE = "I couldn't build an execution plan from that yet.";

export async function runCapabilityPlannerTurn(params: {
  provider: string;
  userId: string;
  emailAccountId: string;
  email: string;
  message: string;
  logger: Logger;
  capabilities: SkillCapabilities;
  forcedCandidateCapabilities?: CapabilityName[];
  continuationBaseMessage?: string;
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
}): Promise<
  | { kind: "clarify"; text: string; continuation: PlannerContinuationState }
  | {
      kind: "executed";
      text: string;
      interactivePayloads: unknown[];
      approvals: Array<{ id: string; requestPayload?: unknown }>;
      debug: {
        routeType: "planner";
        status: string;
        diagnosticsCode?: string;
        diagnosticsCategory?: string;
      };
    }
> {
  const plannerMessage = params.continuationBaseMessage
    ? `${params.continuationBaseMessage}\n\nFollow-up:\n${params.message}`
    : params.message;

  const initialSelection =
    params.forcedCandidateCapabilities && params.forcedCandidateCapabilities.length > 0
      ? {
          candidates: params.forcedCandidateCapabilities,
          reason: "forced_pending_continuation",
          semanticConfidence: 1,
          intentFamilies: [] as string[],
        }
      : await selectCandidateCapabilities({
          message: plannerMessage,
          logger: params.logger,
          emailAccount: {
            id: params.emailAccountId,
            email: params.email,
            userId: params.userId,
          },
        });

  const selectionAttempts: Array<{
    candidates: CapabilityName[];
    reason: string;
    semanticConfidence: number;
    intentFamilies: string[];
  }> = [initialSelection];

  if (!params.forcedCandidateCapabilities || params.forcedCandidateCapabilities.length === 0) {
    const broadenedSelection = await selectCandidateCapabilities({
      message: plannerMessage,
      logger: params.logger,
      emailAccount: {
        id: params.emailAccountId,
        email: params.email,
        userId: params.userId,
      },
      topK: 20,
    });
    if (
      broadenedSelection.candidates.length > initialSelection.candidates.length &&
      broadenedSelection.candidates.some(
        (capability) => !initialSelection.candidates.includes(capability),
      )
    ) {
      selectionAttempts.push({
        ...broadenedSelection,
        reason: `${broadenedSelection.reason}:broadened`,
      });
    }
  }

  emitSkillTelemetry(params.logger, {
    name: "planner.route.selected",
    requestId: `planner:${params.userId}:${Date.now()}`,
    provider: params.provider,
    userId: params.userId,
    routeType: "planner",
    candidateCount: initialSelection.candidates.length,
    semanticParseConfidence: initialSelection.semanticConfidence,
    routedFamilies: initialSelection.intentFamilies,
    reason: initialSelection.reason,
  });

  if (initialSelection.candidates.length === 0) {
    return {
      kind: "clarify",
      text: "I couldn't identify executable inbox/calendar actions from that request. Please be a bit more specific.",
      continuation: {
        baseMessage: plannerMessage,
        candidateCapabilities: [],
      },
    };
  }

  let selectedCandidates = initialSelection.candidates;
  let selectedReason = initialSelection.reason;
  let plan: PlannerPlan | null = null;
  let validationIssueMessages: string[] = [];
  let planBuildFailed = false;

  for (const selection of selectionAttempts) {
    selectedCandidates = selection.candidates;
    selectedReason = selection.reason;

    let attemptPlan: PlannerPlan;
    try {
      attemptPlan = await buildPlannerPlan({
        logger: params.logger,
        emailAccount: {
          id: params.emailAccountId,
          email: params.email,
          userId: params.userId,
        },
        message: plannerMessage,
        candidateCapabilities: selection.candidates,
      });
    } catch (error) {
      params.logger.error("[planner-runtime] plan_build_failed", {
        error,
        selectionReason: selection.reason,
      });
      validationIssueMessages = [PLAN_BUILD_FAILURE_MESSAGE];
      planBuildFailed = true;
      continue;
    }

    let validation = validatePlannerPlan({
      plan: attemptPlan,
      allowedCapabilities: selection.candidates,
    });

    if (!validation.ok) {
      try {
        const repaired = await repairPlannerPlan({
          logger: params.logger,
          emailAccount: {
            id: params.emailAccountId,
            email: params.email,
            userId: params.userId,
          },
          message: plannerMessage,
          candidateCapabilities: selection.candidates,
          priorPlan: attemptPlan,
          issues: validation.issues,
        });
        validation = validatePlannerPlan({
          plan: repaired,
          allowedCapabilities: selection.candidates,
        });
      } catch (error) {
        params.logger.warn("[planner-runtime] repair_failed", {
          error,
          selectionReason: selection.reason,
        });
      }
    }

    if (validation.ok) {
      plan = validation.normalizedPlan ?? attemptPlan;
      break;
    }

    validationIssueMessages = validation.issues.map((issue) => issue.message);
    emitSkillTelemetry(params.logger, {
      name: "planner.validation.failed",
      requestId: `planner:${params.userId}:${Date.now()}`,
      provider: params.provider,
      userId: params.userId,
      routeType: "planner",
      reason: selection.reason,
      issues: validationIssueMessages,
    });
  }

  if (!plan) {
    const missingFields = planBuildFailed ? ["plan_build_failed"] : undefined;
    return {
      kind: "clarify",
      text:
        validationIssueMessages[0] ??
        "I need one more detail to safely build the execution plan.",
      continuation: {
        baseMessage: plannerMessage,
        candidateCapabilities: selectedCandidates,
        missingFields,
      },
    };
  }

  const execution = await executePlannerPlan({
    plan,
    capabilities: params.capabilities,
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    provider: params.provider,
    logger: params.logger,
    context: params.context,
  });

  emitSkillTelemetry(params.logger, {
    name: "planner.execution.completed",
    requestId: `planner:${params.userId}:${Date.now()}`,
    provider: params.provider,
    userId: params.userId,
    routeType: "planner",
    finalOutcome: execution.status,
    diagnosticsCode: execution.diagnosticsCode,
    diagnosticsCategory: execution.diagnosticsCategory,
    stepCount: execution.stepResults.length,
    approvalCount: execution.approvals.length,
    reason: selectedReason,
  });

  if (execution.status === "blocked" && execution.clarificationPrompt) {
    return {
      kind: "clarify",
      text: execution.clarificationPrompt,
      continuation: {
        baseMessage: plannerMessage,
        candidateCapabilities: selectedCandidates,
        clarificationPrompt: execution.clarificationPrompt,
        missingFields: execution.missingFields,
      },
    };
  }

  return {
    kind: "executed",
    text: execution.responseText,
    interactivePayloads: execution.interactivePayloads,
    approvals: execution.approvals,
    debug: {
      routeType: "planner",
      status: execution.status,
      ...(execution.diagnosticsCode
        ? { diagnosticsCode: execution.diagnosticsCode }
        : {}),
      ...(execution.diagnosticsCategory
        ? { diagnosticsCategory: execution.diagnosticsCategory }
        : {}),
    },
  };
}
