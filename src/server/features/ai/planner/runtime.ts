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
import type { CapabilityIntentFamily } from "@/server/features/ai/capabilities/registry";

export interface PlannerContinuationState {
  baseMessage: string;
  candidateCapabilities: CapabilityName[];
  clarificationPrompt?: string;
  missingFields?: string[];
}

const CAPABILITY_INTENT_FAMILY_SET = new Set<CapabilityIntentFamily>([
  "inbox_read",
  "inbox_mutate",
  "inbox_compose",
  "inbox_controls",
  "calendar_read",
  "calendar_mutate",
  "calendar_policy",
  "cross_surface_planning",
]);

function toSeedSemantic(params?: {
  routedFamilies?: string[];
  semanticParseConfidence?: number;
}): { intents: CapabilityIntentFamily[]; confidence: number } | undefined {
  if (!params?.routedFamilies || params.routedFamilies.length === 0) return undefined;
  const intents = params.routedFamilies.filter((family): family is CapabilityIntentFamily =>
    CAPABILITY_INTENT_FAMILY_SET.has(family as CapabilityIntentFamily),
  );
  if (intents.length === 0) return undefined;
  return {
    intents,
    confidence:
      typeof params.semanticParseConfidence === "number"
        ? params.semanticParseConfidence
        : 0.6,
  };
}

function shouldTryBroadenCandidates(params: {
  forced: boolean;
  unresolvedEntities?: string[];
  validationIssues: string[];
}): boolean {
  if (params.forced) return false;
  if ((params.unresolvedEntities ?? []).length > 0) return true;
  return params.validationIssues.some((issue) =>
    /\barg validation failed|unknown dependency|capability outside candidate set\b/i.test(
      issue,
    ),
  );
}

function emitPlannerLatencyTelemetry(params: {
  logger: Logger;
  requestId: string;
  provider: string;
  routeType: "planner" | "clarify";
  stageDurationsMs: Record<string, number>;
  totalMs: number;
}): void {
  emitSkillTelemetry(params.logger, {
    name: "orchestration.stage.latency",
    requestId: params.requestId,
    provider: params.provider,
    routeType: params.routeType,
    stageDurationsMs: params.stageDurationsMs,
    totalMs: params.totalMs,
  });
}

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
  seedRouteContext?: {
    semanticParseConfidence?: number;
    routedFamilies?: string[];
    unresolvedEntities?: string[];
  };
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
  const turnStartedAt = Date.now();
  const requestId = `planner:${params.userId}:${Date.now()}`;
  const stageDurationsMs: Record<string, number> = {};
  const plannerMessage = params.continuationBaseMessage
    ? `${params.continuationBaseMessage}\n\nFollow-up:\n${params.message}`
    : params.message;
  const seedSemantic = toSeedSemantic(params.seedRouteContext);

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
          seedSemantic,
        });
  stageDurationsMs.candidateSelection = Date.now() - turnStartedAt;

  emitSkillTelemetry(params.logger, {
    name: "planner.route.selected",
    requestId,
    provider: params.provider,
    userId: params.userId,
    routeType: "planner",
    candidateCount: initialSelection.candidates.length,
    semanticParseConfidence: initialSelection.semanticConfidence,
    routedFamilies: initialSelection.intentFamilies,
    reason: initialSelection.reason,
  });

  if (initialSelection.candidates.length === 0) {
    emitPlannerLatencyTelemetry({
      logger: params.logger,
      requestId,
      provider: params.provider,
      routeType: "clarify",
      stageDurationsMs,
      totalMs: Date.now() - turnStartedAt,
    });
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
  let selection = initialSelection;
  let broadenAttempted = false;

  while (true) {
    selectedCandidates = selection.candidates;
    selectedReason = selection.reason;

    let attemptPlan: PlannerPlan;
    try {
      const buildStartedAt = Date.now();
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
      stageDurationsMs.planBuild =
        (stageDurationsMs.planBuild ?? 0) + (Date.now() - buildStartedAt);
    } catch (error) {
      params.logger.error("[planner-runtime] plan_build_failed", {
        error,
        selectionReason: selection.reason,
      });
      validationIssueMessages = ["I couldn't build an execution plan from that yet."];
      if (
        !broadenAttempted &&
        shouldTryBroadenCandidates({
          forced:
            Boolean(params.forcedCandidateCapabilities) &&
            (params.forcedCandidateCapabilities?.length ?? 0) > 0,
          unresolvedEntities: params.seedRouteContext?.unresolvedEntities,
          validationIssues: validationIssueMessages,
        })
      ) {
        const broadenStartedAt = Date.now();
        const broadened = await selectCandidateCapabilities({
          message: plannerMessage,
          logger: params.logger,
          emailAccount: {
            id: params.emailAccountId,
            email: params.email,
            userId: params.userId,
          },
          topK: 20,
          seedSemantic,
        });
        stageDurationsMs.broadenSelection =
          (stageDurationsMs.broadenSelection ?? 0) +
          (Date.now() - broadenStartedAt);
        broadenAttempted = true;
        if (
          broadened.candidates.length > selection.candidates.length &&
          broadened.candidates.some(
            (capability) => !selection.candidates.includes(capability),
          )
        ) {
          selection = {
            ...broadened,
            reason: `${broadened.reason}:broadened`,
          };
          continue;
        }
      }
      break;
    }

    const validateStartedAt = Date.now();
    let validation = validatePlannerPlan({
      plan: attemptPlan,
      allowedCapabilities: selection.candidates,
    });
    stageDurationsMs.planValidation =
      (stageDurationsMs.planValidation ?? 0) +
      (Date.now() - validateStartedAt);

    if (!validation.ok) {
      try {
        const repairStartedAt = Date.now();
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
        stageDurationsMs.planRepair =
          (stageDurationsMs.planRepair ?? 0) + (Date.now() - repairStartedAt);
        const revalidateStartedAt = Date.now();
        validation = validatePlannerPlan({
          plan: repaired,
          allowedCapabilities: selection.candidates,
        });
        stageDurationsMs.planValidation =
          (stageDurationsMs.planValidation ?? 0) +
          (Date.now() - revalidateStartedAt);
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
      requestId,
      provider: params.provider,
      userId: params.userId,
      routeType: "planner",
      reason: selection.reason,
      issues: validationIssueMessages,
    });

    if (
      !broadenAttempted &&
      shouldTryBroadenCandidates({
        forced:
          Boolean(params.forcedCandidateCapabilities) &&
          (params.forcedCandidateCapabilities?.length ?? 0) > 0,
        unresolvedEntities: params.seedRouteContext?.unresolvedEntities,
        validationIssues: validationIssueMessages,
      })
    ) {
      const broadenStartedAt = Date.now();
      const broadened = await selectCandidateCapabilities({
        message: plannerMessage,
        logger: params.logger,
        emailAccount: {
          id: params.emailAccountId,
          email: params.email,
          userId: params.userId,
        },
        topK: 20,
        seedSemantic,
      });
      stageDurationsMs.broadenSelection =
        (stageDurationsMs.broadenSelection ?? 0) +
        (Date.now() - broadenStartedAt);
      broadenAttempted = true;
      if (
        broadened.candidates.length > selection.candidates.length &&
        broadened.candidates.some(
          (capability) => !selection.candidates.includes(capability),
        )
      ) {
        selection = {
          ...broadened,
          reason: `${broadened.reason}:broadened`,
        };
        continue;
      }
    }

    break;
  }

  if (!plan) {
    emitPlannerLatencyTelemetry({
      logger: params.logger,
      requestId,
      provider: params.provider,
      routeType: "clarify",
      stageDurationsMs,
      totalMs: Date.now() - turnStartedAt,
    });
    return {
      kind: "clarify",
      text:
        validationIssueMessages[0] ??
        "I need one more detail to safely build the execution plan.",
      continuation: {
        baseMessage: plannerMessage,
        candidateCapabilities: selectedCandidates,
      },
    };
  }

  const executionStartedAt = Date.now();
  const execution = await executePlannerPlan({
    plan,
    capabilities: params.capabilities,
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    provider: params.provider,
    logger: params.logger,
    context: params.context,
  });
  stageDurationsMs.execution =
    (stageDurationsMs.execution ?? 0) + (Date.now() - executionStartedAt);

  emitSkillTelemetry(params.logger, {
    name: "planner.execution.completed",
    requestId,
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

  emitPlannerLatencyTelemetry({
    logger: params.logger,
    requestId,
    provider: params.provider,
    routeType: execution.status === "blocked" ? "clarify" : "planner",
    stageDurationsMs,
    totalMs: Date.now() - turnStartedAt,
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
