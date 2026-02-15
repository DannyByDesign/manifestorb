import type { ModelMessage } from "ai";
import { createGenerateText } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { buildAgentSystemPrompt, type Platform } from "@/server/features/ai/system-prompt";
import { env } from "@/env";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeLoopResult } from "@/server/features/ai/runtime/response-contract";
import { buildRuntimeTurnContext, executeToolCall } from "@/server/features/ai/runtime/tool-runtime";
import { summarizeRuntimeResults } from "@/server/features/ai/runtime/result-summarizer";
import { generateRuntimeUserReply } from "@/server/features/ai/runtime/response-writer";
import { matchRuntimeFastPath } from "@/server/features/ai/runtime/fast-path";
import { buildRuntimeRoutingPlan } from "@/server/features/ai/runtime/router";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
import { emitRuntimeTelemetry } from "@/server/features/ai/runtime/telemetry/schema";
import { runRuntimeSessionRunner } from "@/server/features/ai/runtime/harness/session-runner";
import { emitToolLifecycleEvents } from "@/server/features/ai/runtime/harness/tool-events";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";

const RUNTIME_TURN_BUDGET_MS = 180_000;
const MAX_SKILL_PROMPT_CHARS = 2_200;

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

function toPlatform(provider: string): Platform {
  if (provider === "slack" || provider === "discord" || provider === "telegram") {
    return provider;
  }
  return "web";
}

function buildRuntimeMessages(session: RuntimeSession): ModelMessage[] {
  const history = Array.isArray(session.input.messages) ? session.input.messages : [];
  if (history.length === 0) {
    return [{ role: "user", content: session.input.message }];
  }

  const normalizedCurrent = session.input.message.trim();
  const hasCurrentUserTurn = history.some((message) => {
    if (message.role !== "user") return false;
    if (typeof message.content === "string") {
      return message.content.trim() === normalizedCurrent;
    }
    if (Array.isArray(message.content)) {
      const joined = message.content
        .map((part) => {
          if (!part || typeof part !== "object" || !("type" in part)) return "";
          if (part.type !== "text") return "";
          return "text" in part && typeof part.text === "string" ? part.text : "";
        })
        .join(" ")
        .trim();
      return joined === normalizedCurrent;
    }
    return false;
  });

  return hasCurrentUserTurn
    ? history
    : [...history, { role: "user", content: session.input.message }];
}

function formatNowInTimeZone(timeZone: string): string {
  const now = new Date();
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "long",
  }).format(now);
}

function buildNativeRuntimeSystemPrompt(params: {
  session: RuntimeSession;
  userTimeZone: string;
  lane: string;
}): string {
  const { session, userTimeZone, lane } = params;
  const basePrompt = buildAgentSystemPrompt({
    platform: toPlatform(session.input.provider),
    emailSendEnabled: env.NEXT_PUBLIC_EMAIL_SEND_ENABLED,
    userConfig: session.userPromptConfig,
  });
  const skillSection = session.skillSnapshot.promptSection
    ? session.skillSnapshot.promptSection.slice(0, MAX_SKILL_PROMPT_CHARS)
    : "";

  return [
    basePrompt,
    "Runtime loop policy:",
    `- Route lane: ${lane}.`,
    `- User timezone: ${userTimeZone}.`,
    `- Current local time for the user: ${formatNowInTimeZone(userTimeZone)}.`,
    "- Interpret relative dates (today, tomorrow, monday, next week) in the user timezone.",
    "- Prefer the minimum necessary tool calls for simple requests.",
    "- For greetings/capability questions, answer directly without tools.",
    "- For inbox/calendar facts, call tools rather than guessing.",
    "- If a tool indicates missing fields, ask one precise follow-up question.",
    "- Keep output concise and natural in assistant voice; avoid rigid templated phrasing.",
    ...(skillSection
      ? [
          "Active skill guidance:",
          skillSection,
        ]
      : []),
  ].join("\n");
}

function latestClarificationPrompt(results: RuntimeToolResult[]): string | null {
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const prompt = results[i]?.clarification?.prompt;
    if (typeof prompt === "string" && prompt.trim().length > 0) {
      return prompt.trim();
    }
  }
  return null;
}

function resolveNativeMaxSteps(params: {
  routeMaxSteps: number;
  userConfiguredMaxSteps?: number;
}): number {
  const base = Math.max(1, params.routeMaxSteps);
  const userMax = params.userConfiguredMaxSteps;

  if (typeof userMax !== "number" || !Number.isFinite(userMax)) {
    return base;
  }

  return Math.max(1, Math.min(base, Math.trunc(userMax)));
}

export async function runAttemptLoop(session: RuntimeSession): Promise<RuntimeLoopResult> {
  const context = buildRuntimeTurnContext(session);
  const startedAt = Date.now();
  const routingPlan = await buildRuntimeRoutingPlan({ session });

  const collectedResults = (): RuntimeToolResult[] =>
    context.session.summaries.map((summary) => summary.result);

  session.input.logger.info("Runtime route selected", {
    lane: routingPlan.lane,
    reason: routingPlan.reason,
    nativeMaxSteps: routingPlan.nativeMaxSteps,
    nativeTurnTimeoutMs: routingPlan.nativeTurnTimeoutMs,
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
    nativeMaxSteps: routingPlan.nativeMaxSteps,
    nativeTurnTimeoutMs: routingPlan.nativeTurnTimeoutMs,
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
        results: collectedResults(),
        approvalsCount: context.session.artifacts.approvals.length,
        mode: params.mode,
        fallbackText: params.fallbackText,
      });

    try {
      return await withRuntimeTimeout({
        operation: "response_write",
        timeoutMs: Math.max(5_000, routingPlan.responseWriteTimeoutMs),
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
        toolName: fastPath.toolName,
        args: fastPath.args,
      },
    });

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

    if (fastPath.requireCompleteResult && result.truncated === true) {
      session.input.logger.info("Fast path result incomplete; falling back to planner lane", {
        reason: fastPath.reason,
        toolName: fastPath.toolName,
      });
      return null;
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

  if (routingPlan.fastPathMatch) {
    const strictFastPath = await executeFastPathMatch(routingPlan.fastPathMatch, 1);
    if (strictFastPath) return strictFastPath;
  }

  const modelOptions = getModel("economy");
  const generate = createGenerateText({
    emailAccount: {
      id: session.input.emailAccountId,
      email: session.input.email,
      userId: session.input.userId,
    },
    label: "openworld-runtime-native-turn",
    modelOptions,
  });

  const messages = buildRuntimeMessages(session);
  const resolvedTimeZone = await resolveDefaultCalendarTimeZone({
    userId: session.input.userId,
    emailAccountId: session.input.emailAccountId,
  });
  const userTimeZone = "error" in resolvedTimeZone ? "UTC" : resolvedTimeZone.timeZone;

  const budgetBeforeGenerate = remainingBudgetMs(startedAt);
  if (budgetBeforeGenerate <= 0) {
    return {
      text: await composeAssistantReply({
        mode: "error",
        fallbackText: "I couldn't complete that in time. Please try again.",
      }),
      stopReason: "runtime_error",
      attempts: 1,
    };
  }

  const nativeMaxSteps = resolveNativeMaxSteps({
    routeMaxSteps: routingPlan.nativeMaxSteps,
    userConfiguredMaxSteps: session.userPromptConfig?.maxSteps,
  });
  const nativeTimeoutMs = Math.min(
    Math.max(10_000, routingPlan.nativeTurnTimeoutMs),
    budgetBeforeGenerate,
  );

  let generation;
  try {
    generation = await withRuntimeTimeout({
      operation: "native_generate",
      timeoutMs: nativeTimeoutMs,
      run: () =>
        runRuntimeSessionRunner({
          generate,
          model: modelOptions.model,
          system: buildNativeRuntimeSystemPrompt({
            session,
            userTimeZone,
            lane: routingPlan.lane,
          }),
          messages,
          maxSteps: nativeMaxSteps,
          builtInTools: session.toolHarness.builtInTools,
          customTools: session.toolHarness.customTools,
        }),
    });
  } catch (error) {
    session.input.logger.error("Runtime native generation failed", {
      error,
      lane: routingPlan.lane,
      nativeMaxSteps,
      nativeTimeoutMs,
    });

    const recoveryFastPath = await matchRuntimeFastPath({
      session,
      mode: "recovery",
    });
    if (recoveryFastPath) {
      const recovered = await executeFastPathMatch(recoveryFastPath, 1);
      if (recovered) return recovered;
    }

    return {
      text: await composeAssistantReply({
        mode: "error",
        fallbackText: "I hit a temporary issue while handling that. Please try again.",
      }),
      stopReason: "runtime_error",
      attempts: 1,
    };
  }

  emitToolLifecycleEvents({
    session,
    steps: generation.steps,
  });

  const results = collectedResults();
  const approvalsCount = context.session.artifacts.approvals.length;
  const fallbackText = summarizeRuntimeResults({
    request: session.input.message,
    results,
    approvalsCount,
  });

  const finalText = generation.text.trim();
  const clarificationPrompt = latestClarificationPrompt(results);

  if (approvalsCount > 0) {
    return {
      text:
        finalText ||
        (await composeAssistantReply({
          mode: "approval_pending",
          fallbackText,
        })),
      stopReason: "approval_pending",
      attempts: Math.max(1, generation.steps.length),
    };
  }

  if (clarificationPrompt) {
    return {
      text:
        finalText ||
        (await composeAssistantReply({
          mode: "clarification",
          fallbackText: clarificationPrompt,
        })),
      stopReason: "needs_clarification",
      attempts: Math.max(1, generation.steps.length),
    };
  }

  if (generation.finishReason === "error") {
    return {
      text:
        finalText ||
        (await composeAssistantReply({
          mode: "error",
          fallbackText,
        })),
      stopReason: "runtime_error",
      attempts: Math.max(1, generation.steps.length),
    };
  }

  if (
    (generation.finishReason === "length" || generation.finishReason === "tool-calls") &&
    finalText.length === 0
  ) {
    return {
      text: await composeAssistantReply({
        mode: "final",
        fallbackText,
      }),
      stopReason: "max_attempts",
      attempts: Math.max(1, generation.steps.length),
    };
  }

  return {
    text:
      finalText ||
      (await composeAssistantReply({
        mode: "final",
        fallbackText,
      })),
    stopReason: "completed",
    attempts: Math.max(1, generation.steps.length),
  };
}
