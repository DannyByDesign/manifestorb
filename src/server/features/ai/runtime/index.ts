import { createRuntimeSession } from "@/server/features/ai/runtime/session";
import { runAttemptLoop } from "@/server/features/ai/runtime/attempt-loop";
import { buildFinalUserResponse } from "@/server/features/ai/runtime/finalize";
import type { OpenWorldTurnInput, OpenWorldTurnResult } from "@/server/features/ai/runtime/types";
import { runRuntimePrecheck } from "@/server/features/ai/runtime/context/precheck";
import { hydrateRuntimeContext } from "@/server/features/ai/runtime/context/hydrator";
import { withUserRuntimeConcurrencyLimit } from "@/server/features/ai/runtime/concurrency";
import { emitRuntimeTelemetry } from "@/server/features/ai/runtime/telemetry/schema";

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

    const hydrated = await hydrateRuntimeContext(input);
    emitRuntimeTelemetry(input.logger, "openworld.runtime.context_hydrated", {
      userId: input.userId,
      provider: input.provider,
      status: hydrated.contextStatus,
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
      stopReason: execution.stopReason,
      failureReason,
    });
    return result;
  });
}
