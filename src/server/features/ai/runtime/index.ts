import { createRuntimeSession } from "@/server/features/ai/runtime/session";
import { runRuntimeLoop } from "@/server/features/ai/runtime/loop";
import { finalizeRuntimeResult } from "@/server/features/ai/runtime/response";
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
    const session = await createRuntimeSession({
      ...input,
      message: hydrated.message,
    });
    const execution = await runRuntimeLoop(session);
    const result = finalizeRuntimeResult({
      session,
      text: execution.text,
    });
    const durationMs = Date.now() - startedAt;
    const successes = result.toolSummaries.filter((summary) => summary.outcome === "success").length;
    const blocked = result.toolSummaries.filter((summary) => summary.outcome === "blocked").length;
    const failed = result.toolSummaries.filter((summary) => summary.outcome === "failed").length;
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
    });
    return result;
  });
}
