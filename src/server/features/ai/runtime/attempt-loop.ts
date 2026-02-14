import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeLoopResult } from "@/server/features/ai/runtime/response-contract";
import { generateRuntimeDecision } from "@/server/features/ai/runtime/decision/generate";
import { validateRuntimeDecision } from "@/server/features/ai/runtime/decision/validate";
import { repairRuntimeDecisionArgs } from "@/server/features/ai/runtime/decision/repair";
import { buildRuntimeTurnContext, executeToolCall } from "@/server/features/ai/runtime/tool-runtime";
import { summarizeRuntimeResults } from "@/server/features/ai/runtime/result-summarizer";
import { generateRuntimeUserReply } from "@/server/features/ai/runtime/response-writer";
import { matchRuntimeFastPath } from "@/server/features/ai/runtime/fast-path";
import { buildRuntimeRoutingPlan } from "@/server/features/ai/runtime/router";
import { emitRuntimeTelemetry } from "@/server/features/ai/runtime/telemetry/schema";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";
import type { ValidatedToolDecision } from "@/server/features/ai/runtime/decision/schema";

const RUNTIME_TURN_BUDGET_MS = 120_000;

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
  const routingPlan = await buildRuntimeRoutingPlan({ session });

  session.input.logger.info("Runtime route selected", {
    lane: routingPlan.lane,
    reason: routingPlan.reason,
    maxAttempts: routingPlan.maxAttempts,
    decisionTimeoutMs: routingPlan.decisionTimeoutMs,
    toolCatalogLimit: routingPlan.decisionToolCatalogLimit,
    includeSkillGuidance: routingPlan.includeSkillGuidance,
  });
  emitRuntimeTelemetry(session.input.logger, "openworld.runtime.route_selected", {
    userId: session.input.userId,
    provider: session.input.provider,
    lane: routingPlan.lane,
    reason: routingPlan.reason,
    maxAttempts: routingPlan.maxAttempts,
    decisionTimeoutMs: routingPlan.decisionTimeoutMs,
    toolCatalogLimit: routingPlan.decisionToolCatalogLimit,
    includeSkillGuidance: routingPlan.includeSkillGuidance,
  });

  const composeAssistantReply = async (params: {
    mode: "final" | "clarification" | "approval_pending" | "error";
    fallbackText: string;
  }): Promise<string> => {
    const runWriter = () =>
      generateRuntimeUserReply({
        session,
        request: session.input.message,
        results,
        approvalsCount: context.session.artifacts.approvals.length,
        mode: params.mode,
        fallbackText: params.fallbackText,
      });

    try {
      return await withRuntimeTimeout({
        operation: "response_write",
        timeoutMs: routingPlan.responseWriteTimeoutMs,
        run: runWriter,
      });
    } catch (error) {
      session.input.logger.warn("Runtime response writer failed", {
        error,
        mode: params.mode,
        phase: "primary",
      });

      try {
        return await withRuntimeTimeout({
          operation: "response_write_retry",
          timeoutMs: Math.max(routingPlan.responseWriteTimeoutMs, 25_000),
          run: runWriter,
        });
      } catch (retryError) {
        session.input.logger.error("Runtime response writer failed after retry", {
          error: retryError,
          mode: params.mode,
        });
        return "I ran into a temporary issue on my side. Please try again, and I'll pick it up from there.";
      }
    }
  };
  const executeFastPathMatch = async (
    fastPath: NonNullable<Awaited<ReturnType<typeof matchRuntimeFastPath>>>,
    attempt: number,
  ): Promise<RuntimeLoopResult | null> => {
    if (fastPath.type === "respond") {
      return {
        text: await composeAssistantReply({
          mode: "final",
          fallbackText: fastPath.text,
        }),
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
        text: await composeAssistantReply({
          mode: "error",
          fallbackText: result.message ?? fastPath.onFailureText,
        }),
        stopReason: "runtime_error",
        attempts: attempt,
      };
    }

    return {
      text: await composeAssistantReply({
        mode: "final",
        fallbackText: fastPath.summarize(result),
      }),
      stopReason: "completed",
      attempts: attempt,
    };
  };
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

    return executeFastPathMatch(fastPath, attempt);
  };

  if (routingPlan.fastPathMatch) {
    const strictFastPath = await executeFastPathMatch(routingPlan.fastPathMatch, 1);
    if (strictFastPath) return strictFastPath;
  }

  for (let attempt = 1; attempt <= routingPlan.maxAttempts; attempt += 1) {
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
        timeoutMs: Math.min(routingPlan.decisionTimeoutMs, budgetBeforeDecision),
        run: () =>
          generateRuntimeDecision({
            session,
            executedResults: results,
            attempt,
            route: {
              toolCatalogLimit: routingPlan.decisionToolCatalogLimit,
              includeSkillGuidance: routingPlan.includeSkillGuidance,
            },
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
        if (attempt >= routingPlan.maxAttempts) {
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
          timeoutMs: Math.min(routingPlan.repairTimeoutMs, budgetBeforeRepair),
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
      if (attempt >= routingPlan.maxAttempts) {
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
    attempts: routingPlan.maxAttempts,
  };
}
