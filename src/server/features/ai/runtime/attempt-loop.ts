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
import { buildRuntimeRoutingPlan } from "@/server/features/ai/runtime/router";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
import { emitRuntimeTelemetry } from "@/server/features/ai/runtime/telemetry/schema";
import { runRuntimeSessionRunner } from "@/server/features/ai/runtime/harness/session-runner";
import { emitToolLifecycleEvents } from "@/server/features/ai/runtime/harness/tool-events";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";
import { renderRuntimeContextForPrompt } from "@/server/features/ai/runtime/context/render";
import {
  pruneRuntimeMessages,
  resolveRuntimeMessagePruningConfig,
  estimateRuntimeMessagesChars,
} from "@/server/features/ai/runtime/context/pruning";
import {
  maybeRunPreCompactionMemoryFlush,
  resolveMemoryFlushThresholdRatio,
} from "@/server/features/ai/runtime/context/memory-flush";
import { resolveRuntimeContextSlotBudget } from "@/server/features/ai/runtime/context/slot-budget";

const RUNTIME_TURN_BUDGET_MS = 180_000;
const MAX_SKILL_PROMPT_CHARS = 2_200;
const SINGLE_TOOL_TIMEOUT_MIN_MS = 3_000;
const SINGLE_TOOL_TIMEOUT_MAX_MS = 15_000;

function resolveSingleToolTimeoutMs(): number {
  const raw = process.env.RUNTIME_SINGLE_TOOL_TIMEOUT_MS;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      return Math.min(Math.max(parsed, SINGLE_TOOL_TIMEOUT_MIN_MS), SINGLE_TOOL_TIMEOUT_MAX_MS);
    }
  }
  return 9_000;
}

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

function extractMessageTextContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object" || !("type" in part)) return "";
      if (part.type !== "text") return "";
      return "text" in part && typeof part.text === "string" ? part.text : "";
    })
    .join(" ")
    .trim();
}

function normalizeRuntimeHistoryForProvider(history: ModelMessage[]): ModelMessage[] {
  const normalized: ModelMessage[] = [];

  for (const message of history) {
    if (message.role !== "system") {
      normalized.push(message);
      continue;
    }

    const systemText = extractMessageTextContent(message.content);
    if (!systemText) continue;

    if (normalized.length === 0) {
      normalized.push({ role: "system", content: systemText });
      continue;
    }

    normalized.push({
      role: "assistant",
      content: `Context note: ${systemText}`,
    });
  }

  return normalized;
}

export function buildRuntimeMessages(session: RuntimeSession): ModelMessage[] {
  const history = Array.isArray(session.input.messages)
    ? normalizeRuntimeHistoryForProvider(session.input.messages)
    : [];
  if (history.length === 0) {
    return [{ role: "user", content: session.input.message }];
  }

  const normalizedCurrent = session.input.message.trim();
  const lastMessage = history[history.length - 1];
  const hasCurrentUserTurn = (() => {
    if (!lastMessage || lastMessage.role !== "user") return false;
    if (typeof lastMessage.content === "string") {
      return lastMessage.content.trim() === normalizedCurrent;
    }
    if (!Array.isArray(lastMessage.content)) return false;

    const joined = lastMessage.content
      .map((part) => {
        if (!part || typeof part !== "object" || !("type" in part)) return "";
        if (part.type !== "text") return "";
        return "text" in part && typeof part.text === "string" ? part.text : "";
      })
      .join(" ")
      .trim();

    return joined === normalizedCurrent;
  })();

  return hasCurrentUserTurn ? history : [...history, { role: "user", content: session.input.message }];
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
  const slotBudget = resolveRuntimeContextSlotBudget(lane as Parameters<typeof resolveRuntimeContextSlotBudget>[0]);
  const contextSection = renderRuntimeContextForPrompt(session.input.runtimeContextPack, {
    maxChars: slotBudget.maxChars,
    maxFacts: slotBudget.maxFacts,
    maxKnowledge: slotBudget.maxKnowledge,
    maxHistory: slotBudget.maxHistory,
  });
  const contextStatus = session.input.runtimeContextStatus;
  const contextIssues = session.input.runtimeContextIssues?.slice(0, 5) ?? [];

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
    "- For follow-up questions about prior results (for example: 'the second one' or 'why that email'), ground your answer in the latest turn evidence before running a new search.",
    "- Treat scheduled tasks as valid calendar rescheduling targets when the user asks to move/reschedule a task.",
    "- Do not claim missing capability for task/calendar rescheduling when runtime tools are available; ask a clarifying question if identifiers are missing.",
    "- If a tool indicates missing fields, ask one precise follow-up question.",
    "- Keep output concise and natural in assistant voice; avoid rigid templated phrasing.",
    ...(contextStatus && contextStatus !== "ready"
      ? [`- Runtime memory context status: ${contextStatus}${contextIssues.length > 0 ? ` (${contextIssues.join(", ")})` : ""}.`]
      : []),
    ...(contextSection.promptBlock
      ? [
          "Runtime memory context (read-only):",
          contextSection.promptBlock,
        ]
      : []),
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

function isOverflowLikeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("context length") ||
    message.includes("maximum context length") ||
    message.includes("too many tokens") ||
    message.includes("input is too long") ||
    message.includes("token limit") ||
    message.includes("context_window_exceeded")
  );
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
    profile: routingPlan.profile,
    reason: routingPlan.reason,
    nativeMaxSteps: routingPlan.nativeMaxSteps,
    nativeTurnTimeoutMs: routingPlan.nativeTurnTimeoutMs,
    maxAttempts: routingPlan.maxAttempts,
    decisionTimeoutMs: routingPlan.decisionTimeoutMs,
    toolCatalogLimit: routingPlan.decisionToolCatalogLimit,
    includeSkillGuidance: routingPlan.includeSkillGuidance,
    turnIntent: session.turn.intent,
    turnRouteHint: session.turn.routeHint,
  });
  emitRuntimeTelemetry(session.input.logger, "openworld.runtime.route_selected", {
    userId: session.input.userId,
    provider: session.input.provider,
    lane: routingPlan.lane,
    profile: routingPlan.profile,
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

  const finalizeFromCurrentResults = async (): Promise<RuntimeLoopResult> => {
    const approvalsCount = context.session.artifacts.approvals.length;
    const results = collectedResults();
    const clarificationPrompt = latestClarificationPrompt(results);
    const fallbackText = summarizeRuntimeResults({
      request: session.input.message,
      results,
      approvalsCount,
    });

    if (approvalsCount > 0) {
      return {
        text: await composeAssistantReply({
          mode: "approval_pending",
          fallbackText,
        }),
        stopReason: "approval_pending",
        attempts: 1,
      };
    }

    if (clarificationPrompt) {
      return {
        text: await composeAssistantReply({
          mode: "clarification",
          fallbackText: clarificationPrompt,
        }),
        stopReason: "needs_clarification",
        attempts: 1,
      };
    }

    return {
      text: await composeAssistantReply({
        mode: "final",
        fallbackText,
      }),
      stopReason: "completed",
      attempts: 1,
    };
  };

  if (routingPlan.lane === "conversation_only") {
    return {
      text: await composeAssistantReply({
        mode: "final",
        fallbackText:
          routingPlan.conversationFallbackText ??
          session.turn.conversationFallbackText ??
          "How can I help you next?",
      }),
      stopReason: "completed",
      attempts: 1,
    };
  }

  if (routingPlan.lane === "single_tool" && routingPlan.singleToolCall) {
    const toolStartedAt = Date.now();
    try {
      await withRuntimeTimeout({
        operation: "single_tool_execution",
        timeoutMs: resolveSingleToolTimeoutMs(),
        run: () =>
          executeToolCall({
            context,
            decision: {
              toolName: routingPlan.singleToolCall!.toolName,
              args: routingPlan.singleToolCall!.args,
            },
          }),
      });
    } catch (error) {
      session.input.logger.warn("Single-tool lane execution failed", {
        error,
        toolName: routingPlan.singleToolCall.toolName,
        reason: routingPlan.singleToolCall.reason,
        latencyMs: Date.now() - toolStartedAt,
      });
      return {
        text: await composeAssistantReply({
          mode: "error",
          fallbackText:
            routingPlan.singleToolCall.onFailureText ??
            "I hit a temporary issue while handling that. Please try again.",
        }),
        stopReason: "runtime_error",
        attempts: 1,
      };
    }

    return finalizeFromCurrentResults();
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

  const slotBudget = resolveRuntimeContextSlotBudget(
    routingPlan.lane as Parameters<typeof resolveRuntimeContextSlotBudget>[0],
  );
  emitRuntimeTelemetry(session.input.logger, "openworld.runtime.context_slots", {
    userId: session.input.userId,
    provider: session.input.provider,
    lane: routingPlan.lane as Parameters<typeof resolveRuntimeContextSlotBudget>[0],
    maxChars: slotBudget.maxChars,
    maxFacts: slotBudget.maxFacts,
    maxKnowledge: slotBudget.maxKnowledge,
    maxHistory: slotBudget.maxHistory,
  });

  const baseMessages = buildRuntimeMessages(session);
  const pruningConfig = resolveRuntimeMessagePruningConfig();
  const softPrune = pruneRuntimeMessages({
    messages: baseMessages,
    mode: "soft",
    config: pruningConfig,
  });
  if (softPrune.pruned) {
    emitRuntimeTelemetry(session.input.logger, "openworld.runtime.context_pruned", {
      userId: session.input.userId,
      provider: session.input.provider,
      lane: routingPlan.lane as Parameters<typeof resolveRuntimeContextSlotBudget>[0],
      mode: "soft",
      beforeChars: softPrune.beforeChars,
      afterChars: softPrune.afterChars,
      removedCount: softPrune.removedCount,
      truncatedCount: softPrune.truncatedCount,
    });
  }
  let messagesForGeneration = softPrune.messages;

  const flushThresholdRatio = resolveMemoryFlushThresholdRatio();
  if (softPrune.afterChars > pruningConfig.hardLimitChars * flushThresholdRatio) {
    await maybeRunPreCompactionMemoryFlush({
      session,
      reason: "threshold",
    });
  }

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

  const runNativeGeneration = (runtimeMessages: ModelMessage[]) =>
    withRuntimeTimeout({
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
          messages: runtimeMessages,
          maxSteps: nativeMaxSteps,
          builtInTools: session.toolHarness.builtInTools,
          customTools: session.toolHarness.customTools,
        }),
    });

  let generation;
  try {
    generation = await runNativeGeneration(messagesForGeneration);
  } catch (error) {
    session.input.logger.error("Runtime native generation failed", {
      error,
      lane: routingPlan.lane,
      nativeMaxSteps,
      nativeTimeoutMs,
    });

    if (isOverflowLikeError(error)) {
      const flushQueued = await maybeRunPreCompactionMemoryFlush({
        session,
        reason: "overflow",
      });
      const hardPrune = pruneRuntimeMessages({
        messages: messagesForGeneration,
        mode: "hard",
        config: pruningConfig,
      });

      emitRuntimeTelemetry(session.input.logger, "openworld.runtime.compaction_retry", {
        userId: session.input.userId,
        provider: session.input.provider,
        lane: routingPlan.lane as Parameters<typeof resolveRuntimeContextSlotBudget>[0],
        overflowDetected: true,
        retryAttempted: true,
        retrySucceeded: false,
        beforeChars: estimateRuntimeMessagesChars(messagesForGeneration),
        afterChars: hardPrune.afterChars,
        memoryFlushQueued: flushQueued,
      });

      if (hardPrune.pruned) {
        emitRuntimeTelemetry(session.input.logger, "openworld.runtime.context_pruned", {
          userId: session.input.userId,
          provider: session.input.provider,
          lane: routingPlan.lane as Parameters<typeof resolveRuntimeContextSlotBudget>[0],
          mode: "hard",
          beforeChars: hardPrune.beforeChars,
          afterChars: hardPrune.afterChars,
          removedCount: hardPrune.removedCount,
          truncatedCount: hardPrune.truncatedCount,
        });
      }

      if (
        hardPrune.afterChars < estimateRuntimeMessagesChars(messagesForGeneration) &&
        hardPrune.messages.length > 0
      ) {
        try {
          messagesForGeneration = hardPrune.messages;
          generation = await runNativeGeneration(messagesForGeneration);
          emitRuntimeTelemetry(session.input.logger, "openworld.runtime.compaction_retry", {
            userId: session.input.userId,
            provider: session.input.provider,
            lane: routingPlan.lane as Parameters<typeof resolveRuntimeContextSlotBudget>[0],
            overflowDetected: true,
            retryAttempted: true,
            retrySucceeded: true,
            beforeChars: hardPrune.beforeChars,
            afterChars: hardPrune.afterChars,
            memoryFlushQueued: flushQueued,
          });
        } catch (retryError) {
          session.input.logger.error("Runtime compaction retry failed", {
            error: retryError,
            lane: routingPlan.lane,
          });
        }
      }
    }

    if (!generation) {
      return {
        text: await composeAssistantReply({
          mode: "error",
          fallbackText: "I hit a temporary issue while handling that. Please try again.",
        }),
        stopReason: "runtime_error",
        attempts: 1,
      };
    }
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
