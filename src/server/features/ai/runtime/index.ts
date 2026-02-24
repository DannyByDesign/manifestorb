import { createRuntimeSession } from "@/server/features/ai/runtime/session";
import { runAttemptLoop } from "@/server/features/ai/runtime/attempt-loop";
import { buildFinalUserResponse } from "@/server/features/ai/runtime/finalize";
import type { OpenWorldTurnInput, OpenWorldTurnResult } from "@/server/features/ai/runtime/types";
import { runRuntimePrecheck } from "@/server/features/ai/runtime/context/precheck";
import { hydrateRuntimeContext } from "@/server/features/ai/runtime/context/hydrator";
import { withUserRuntimeConcurrencyLimit } from "@/server/features/ai/runtime/concurrency";
import { emitRuntimeTelemetry } from "@/server/features/ai/runtime/telemetry/schema";
import { env } from "@/env";
import { planRuntimeTurn } from "@/server/features/ai/runtime/turn-planner";

const EMAIL_SEARCH_TOOL_NAMES = new Set([
  "email.getUnreadCount",
  "email.countUnread",
  "email.searchThreads",
  "email.searchThreadsAdvanced",
  "email.searchSent",
  "email.searchInbox",
  "email.facetThreads",
]);

const TASK_RESCHEDULE_TOOL_NAMES = new Set([
  "task.reschedule",
  "task.bulkReschedule",
  "calendar.rescheduleEvent",
]);

function resolveUsdPerMillion(raw: string | undefined): number {
  if (typeof raw !== "string") return 0;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function estimateTurnCostUsd(params: {
  inputTokens: number;
  outputTokens: number;
}): number | undefined {
  const inputUsdPerMillion = resolveUsdPerMillion(
    env.RUNTIME_COST_INPUT_USD_PER_1M_TOKENS,
  );
  const outputUsdPerMillion = resolveUsdPerMillion(
    env.RUNTIME_COST_OUTPUT_USD_PER_1M_TOKENS,
  );
  if (inputUsdPerMillion <= 0 && outputUsdPerMillion <= 0) {
    return undefined;
  }
  const usd =
    (params.inputTokens / 1_000_000) * inputUsdPerMillion +
    (params.outputTokens / 1_000_000) * outputUsdPerMillion;
  return Number.isFinite(usd) ? Math.max(0, usd) : undefined;
}

export async function runOpenWorldRuntimeTurn(
  input: OpenWorldTurnInput,
): Promise<OpenWorldTurnResult> {
  return withUserRuntimeConcurrencyLimit(input.userId, async () => {
    const startedAt = Date.now();
    const precheck = runRuntimePrecheck(input);
    if (!precheck.ok) {
      emitRuntimeTelemetry(input.logger, "openworld.runtime.precheck_failed", {
        userId: input.userId,
        provider: input.provider,
        issues: precheck.issues,
      });
      return {
        text:
          precheck.userMessage ??
          "I’m missing required context to execute that request.",
        approvals: [],
        interactivePayloads: [],
        selectedSkillIds: [],
        toolSummaries: [],
      };
    }

    const plannedTurn = await planRuntimeTurn({
      userId: input.userId,
      emailAccountId: input.emailAccountId,
      email: input.email,
      provider: input.provider,
      message: input.message,
      logger: input.logger,
    });
    const telemetryIntent =
      plannedTurn.requestedOperation === "read" ||
      plannedTurn.requestedOperation === "mutate" ||
      plannedTurn.requestedOperation === "mixed"
        ? plannedTurn.requestedOperation
        : "unknown";
    emitRuntimeTelemetry(input.logger, "openworld.runtime.plan", {
      userId: input.userId,
      provider: input.provider,
      source: plannedTurn.source,
      intent: telemetryIntent,
      confidence: plannedTurn.confidence,
      stepCount: 0,
      issueCount: plannedTurn.metaConstraints.length,
    });

    const hydrated = await hydrateRuntimeContext({
      ...input,
      runtimeTurnContract: plannedTurn,
    });
    emitRuntimeTelemetry(input.logger, "openworld.runtime.context_hydrated", {
      userId: input.userId,
      provider: input.provider,
      status: hydrated.contextStatus,
      tier: hydrated.hydrationTier,
      issues: hydrated.contextIssues,
      facts: hydrated.contextStats.facts,
      knowledge: hydrated.contextStats.knowledge,
      history: hydrated.contextStats.history,
      attentionItems: hydrated.contextStats.attentionItems,
      hasSummary: hydrated.contextStats.hasSummary,
      hasPendingState: hydrated.contextStats.hasPendingState,
    });
    const session = await createRuntimeSession({
      ...input,
      message: hydrated.message,
      runtimeContextPack: hydrated.contextPack,
      runtimeContextStatus: hydrated.contextStatus,
      runtimeContextIssues: hydrated.contextIssues,
      runtimeTurnContract: plannedTurn,
    });
    const execution = await runAttemptLoop(session);
    const result = buildFinalUserResponse({
      session,
      loopResult: execution,
    });
    const durationMs = Date.now() - startedAt;
    const successes = result.toolSummaries.filter((summary) => summary.outcome === "success").length;
    const blocked = result.toolSummaries.filter((summary) => summary.outcome === "blocked").length;
    const failed = result.toolSummaries.filter((summary) => summary.outcome === "failed").length;
    const failureReason =
      execution.stopReason === "completed" || execution.stopReason === "approval_pending"
        ? undefined
        : execution.stopReason;
    const usage = execution.usage;
    const turnCostUsd =
      usage &&
      estimateTurnCostUsd({
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });

    emitRuntimeTelemetry(input.logger, "openworld.turn.completed", {
      userId: input.userId,
      provider: input.provider,
      durationMs,
      stepCount: result.toolSummaries.length,
      successes,
      blocked,
      failed,
      approvalsCount: result.approvals.length,
      interactivePayloadsCount: result.interactivePayloads.length,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
      turnCostUsd,
      stopReason: execution.stopReason,
      failureReason,
    });

    if (usage && typeof turnCostUsd === "number") {
      emitRuntimeTelemetry(input.logger, "openworld.metric.turn_cost_usd", {
        userId: input.userId,
        provider: input.provider,
        turnCostUsd,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      });
    }

    const emailSearchCalls = result.toolSummaries.filter((summary) =>
      EMAIL_SEARCH_TOOL_NAMES.has(summary.toolName),
    );
    if (emailSearchCalls.length > 0) {
      const emailSearchSuccesses = emailSearchCalls.filter(
        (summary) => summary.outcome === "success",
      ).length;
      emitRuntimeTelemetry(input.logger, "openworld.metric.email_search_success_rate", {
        userId: input.userId,
        provider: input.provider,
        attempts: emailSearchCalls.length,
        successes: emailSearchSuccesses,
        failures: emailSearchCalls.length - emailSearchSuccesses,
        successRate: emailSearchSuccesses / emailSearchCalls.length,
      });
    }

    const taskRescheduleCalls = result.toolSummaries.filter((summary) =>
      TASK_RESCHEDULE_TOOL_NAMES.has(summary.toolName),
    );
    if (taskRescheduleCalls.length > 0) {
      const taskRescheduleSuccesses = taskRescheduleCalls.filter(
        (summary) => summary.outcome === "success",
      ).length;
      emitRuntimeTelemetry(input.logger, "openworld.metric.task_reschedule_success_rate", {
        userId: input.userId,
        provider: input.provider,
        attempts: taskRescheduleCalls.length,
        successes: taskRescheduleSuccesses,
        failures: taskRescheduleCalls.length - taskRescheduleSuccesses,
        successRate: taskRescheduleSuccesses / taskRescheduleCalls.length,
      });
    }

    const perToolStats = new Map<string, { total: number; failed: number }>();
    for (const summary of result.toolSummaries) {
      const stats = perToolStats.get(summary.toolName) ?? { total: 0, failed: 0 };
      stats.total += 1;
      if (summary.outcome === "failed") stats.failed += 1;
      perToolStats.set(summary.toolName, stats);
    }
    for (const [toolName, stats] of perToolStats.entries()) {
      emitRuntimeTelemetry(input.logger, "openworld.metric.tool_call_failure_rate_by_tool", {
        userId: input.userId,
        provider: input.provider,
        toolName,
        totalCalls: stats.total,
        failedCalls: stats.failed,
        failureRate: stats.total > 0 ? stats.failed / stats.total : 0,
      });
    }

    return result;
  });
}
