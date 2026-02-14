import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeLoopResult } from "@/server/features/ai/runtime/response-contract";
import { generateRuntimeDecision } from "@/server/features/ai/runtime/decision/generate";
import { validateRuntimeDecision } from "@/server/features/ai/runtime/decision/validate";
import { repairRuntimeDecisionArgs } from "@/server/features/ai/runtime/decision/repair";
import { buildRuntimeTurnContext, executeToolCall } from "@/server/features/ai/runtime/tool-runtime";
import { summarizeRuntimeResults } from "@/server/features/ai/runtime/result-summarizer";
import { generateRuntimeUserReply } from "@/server/features/ai/runtime/response-writer";
import { matchRuntimeFastPath } from "@/server/features/ai/runtime/fast-path";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";
import type { ValidatedToolDecision } from "@/server/features/ai/runtime/decision/schema";

const MAX_RUNTIME_ATTEMPTS = 6;
const RUNTIME_TURN_BUDGET_MS = 90_000;
const DECISION_TIMEOUT_MS = 18_000;
const REPAIR_TIMEOUT_MS = 8_000;
const RESPONSE_WRITE_TIMEOUT_MS = 10_000;

class RuntimeOperationTimeoutError extends Error {
  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
  ) {
    super(`runtime_operation_timeout:${operation}:${timeoutMs}`);
    this.name = "RuntimeOperationTimeoutError";
  }
}

function remainingBudgetMs(startedAt: number): number {
  return RUNTIME_TURN_BUDGET_MS - (Date.now() - startedAt);
}

async function withRuntimeTimeout<T>(params: {
  operation: string;
  timeoutMs: number;
  run: () => Promise<T>;
}): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      params.run(),
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new RuntimeOperationTimeoutError(params.operation, params.timeoutMs));
        }, params.timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export async function runAttemptLoop(session: RuntimeSession): Promise<RuntimeLoopResult> {
  const context = buildRuntimeTurnContext(session);
  const results: RuntimeToolResult[] = [];
  const startedAt = Date.now();
  const runFastPath = async (
    mode: "strict" | "recovery",
    attempt: number,
  ): Promise<RuntimeLoopResult | null> => {
    const fastPath = await matchRuntimeFastPath({ session, mode });
    if (!fastPath) return null;

    session.input.logger.info("Runtime fast path matched", {
      mode,
      attempt,
      reason: fastPath.reason,
      type: fastPath.type,
      toolName: fastPath.type === "tool_call" ? fastPath.toolName : null,
    });

    if (fastPath.type === "respond") {
      return {
        text: fastPath.text,
        stopReason: "completed",
        attempts: attempt,
      };
    }

    const result = await executeToolCall({
      context,
      decision: {
        type: "tool_call",
        toolName: fastPath.toolName,
        args: fastPath.args,
      },
    });
    results.push(result);

    if (!result.success) {
      return {
        text: result.message ?? fastPath.onFailureText,
        stopReason: "runtime_error",
        attempts: attempt,
      };
    }

    return {
      text: fastPath.summarize(result),
      stopReason: "completed",
      attempts: attempt,
    };
  };

  const composeAssistantReply = async (params: {
    mode: "final" | "clarification" | "approval_pending" | "error";
    fallbackText: string;
  }): Promise<string> => {
    const budget = remainingBudgetMs(startedAt);
    if (budget <= 1000) return params.fallbackText;

    try {
      return await withRuntimeTimeout({
        operation: "response_write",
        timeoutMs: Math.min(RESPONSE_WRITE_TIMEOUT_MS, budget),
        run: () =>
          generateRuntimeUserReply({
            session,
            request: session.input.message,
            results,
            approvalsCount: context.session.artifacts.approvals.length,
            mode: params.mode,
            fallbackText: params.fallbackText,
          }),
      });
    } catch (error) {
      session.input.logger.warn("Runtime response writer failed", {
        error,
        mode: params.mode,
      });
      return params.fallbackText;
    }
  };

  const strictFastPath = await runFastPath("strict", 1);
  if (strictFastPath) return strictFastPath;

  for (let attempt = 1; attempt <= MAX_RUNTIME_ATTEMPTS; attempt += 1) {
    const budgetBeforeDecision = remainingBudgetMs(startedAt);
    if (budgetBeforeDecision <= 0) {
      return {
        text: "I couldn't complete that in time. Please try again and I'll run a faster pass.",
        stopReason: "runtime_error",
        attempts: attempt - 1,
      };
    }

    let decision;
    try {
      decision = await withRuntimeTimeout({
        operation: "decision_generate",
        timeoutMs: Math.min(DECISION_TIMEOUT_MS, budgetBeforeDecision),
        run: () =>
          generateRuntimeDecision({
            session,
            executedResults: results,
            attempt,
          }),
      });
    } catch (error) {
      session.input.logger.error("Runtime decision generation failed", {
        error,
        attempt,
      });
      const recoveryFastPath = await runFastPath("recovery", attempt);
      if (recoveryFastPath) return recoveryFastPath;
      return {
        text: "I hit a temporary issue planning that request. Please try once more.",
        stopReason: "runtime_error",
        attempts: attempt,
      };
    }

    let validated = validateRuntimeDecision({ decision, session });

    if (!validated.ok && validated.toolName) {
      const failedValidation = validated;
      const toolName = failedValidation.toolName;
      if (!toolName) {
        if (attempt >= MAX_RUNTIME_ATTEMPTS) {
          const fallbackText =
            "I need one more detail before I can continue. Please restate the request in one sentence with the exact outcome you want.";
          return {
            text: await composeAssistantReply({
              mode: "clarification",
              fallbackText,
            }),
            stopReason: "needs_clarification",
            attempts: attempt,
          };
        }
        continue;
      }
      const budgetBeforeRepair = remainingBudgetMs(startedAt);
      if (budgetBeforeRepair <= 0) {
        return {
          text: "I couldn't complete that in time. Please try again and I'll run a faster pass.",
          stopReason: "runtime_error",
          attempts: attempt,
        };
      }

      let repairedArgsJson: string | null = null;
      try {
        repairedArgsJson = await withRuntimeTimeout({
          operation: "decision_repair",
          timeoutMs: Math.min(REPAIR_TIMEOUT_MS, budgetBeforeRepair),
          run: () =>
            repairRuntimeDecisionArgs({
              session,
              toolName,
              previousArgsJson: failedValidation.argsJson,
              validationReason: failedValidation.reason,
            }),
        });
      } catch (error) {
        session.input.logger.warn("Runtime decision repair timed out or failed", {
          error,
          attempt,
          toolName,
          reason: failedValidation.reason,
        });
      }

      if (repairedArgsJson) {
        validated = validateRuntimeDecision({
          decision: {
            type: "tool_call",
            toolName,
            argsJson: repairedArgsJson,
            rationale: decision.rationale,
          },
          session,
        });
      }
    }

    if (!validated.ok) {
      if (attempt >= MAX_RUNTIME_ATTEMPTS) {
        const fallbackText =
          "I need one more detail before I can continue. Please restate the request in one sentence with the exact outcome you want.";
        return {
          text: await composeAssistantReply({
            mode: "clarification",
            fallbackText,
          }),
          stopReason: "needs_clarification",
          attempts: attempt,
        };
      }
      continue;
    }

    const resolvedDecision = validated.decision;

    if (resolvedDecision.type === "respond") {
      const fallbackText = "Completed.";
      return {
        text:
          resolvedDecision.responseText?.trim() ||
          (await composeAssistantReply({
            mode: "final",
            fallbackText,
          })),
        stopReason: "completed",
        attempts: attempt,
      };
    }

    if (resolvedDecision.type === "clarify") {
      const fallbackText =
        "I need one more detail to proceed. What exact change should I make?";
      return {
        text:
          resolvedDecision.responseText?.trim() ||
          (await composeAssistantReply({
            mode: "clarification",
            fallbackText,
          })),
        stopReason: "needs_clarification",
        attempts: attempt,
      };
    }

    if (!("args" in resolvedDecision)) {
      continue;
    }

    const result = await executeToolCall({
      context,
      decision: resolvedDecision as ValidatedToolDecision,
    });

    results.push(result);

    if (!result.success) {
      if (
        result.error === "tool_timeout" ||
        result.error === "rate_limit" ||
        result.error === "transient" ||
        result.error === "auth_error" ||
        result.error === "permission_denied"
      ) {
        const fallbackText =
          result.message ??
          "I couldn't complete that right now due to a temporary provider issue. Please try again.";
        return {
          text: await composeAssistantReply({
            mode: "error",
            fallbackText,
          }),
          stopReason: "runtime_error",
          attempts: attempt,
        };
      }
    }

    if (result.clarification?.prompt) {
      const fallbackText = result.clarification.prompt;
      return {
        text: await composeAssistantReply({
          mode: "clarification",
          fallbackText,
        }),
        stopReason: "needs_clarification",
        attempts: attempt,
      };
    }

    if (context.session.artifacts.approvals.length > 0) {
      const fallbackText = summarizeRuntimeResults({
        request: session.input.message,
        results,
        approvalsCount: context.session.artifacts.approvals.length,
      });
      return {
        text: await composeAssistantReply({
          mode: "approval_pending",
          fallbackText,
        }),
        stopReason: "approval_pending",
        attempts: attempt,
      };
    }

    if (result.success && attempt >= 2) {
      const fallbackText = summarizeRuntimeResults({
        request: session.input.message,
        results,
        approvalsCount: context.session.artifacts.approvals.length,
      });
      return {
        text: await composeAssistantReply({
          mode: "final",
          fallbackText,
        }),
        stopReason: "completed",
        attempts: attempt,
      };
    }
  }

  const fallbackText = summarizeRuntimeResults({
    request: session.input.message,
    results,
    approvalsCount: session.artifacts.approvals.length,
  });
  return {
    text: await composeAssistantReply({
      mode: "final",
      fallbackText,
    }),
    stopReason: "max_attempts",
    attempts: MAX_RUNTIME_ATTEMPTS,
  };
}
