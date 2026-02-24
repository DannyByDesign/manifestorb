import type { ModelMessage } from "ai";
import { createGenerateText } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { buildAgentSystemPrompt, type Platform } from "@/server/features/ai/system-prompt";
import { env } from "@/env";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeLoopResult } from "@/server/features/ai/runtime/response-contract";
import { summarizeRuntimeResults } from "@/server/features/ai/runtime/result-summarizer";
import { generateRuntimeUserReply } from "@/server/features/ai/runtime/response-writer";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
import { emitRuntimeTelemetry } from "@/server/features/ai/runtime/telemetry/schema";
import { runRuntimeSessionRunner } from "@/server/features/ai/runtime/harness/session-runner";
import { emitToolLifecycleEvents } from "@/server/features/ai/runtime/harness/tool-events";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";
import { renderRuntimeContextForPrompt } from "@/server/features/ai/runtime/context/render";
import {
  capTimeoutToRuntimeBudget,
  runWithRuntimeDeadlineContext,
} from "@/server/features/ai/runtime/deadline-context";
import {
  pruneRuntimeMessages,
  resolveRuntimeMessagePruningConfig,
  estimateRuntimeMessagesChars,
} from "@/server/features/ai/runtime/context/pruning";
import {
  maybeRunPreCompactionMemoryFlush,
  resolveMemoryFlushThresholdRatio,
} from "@/server/features/ai/runtime/context/memory-flush";
import { resolveRuntimeContextSlotBudget, type RuntimeLane } from "@/server/features/ai/runtime/context/slot-budget";

const RUNTIME_TURN_BUDGET_MS = 180_000;
const MAX_SKILL_PROMPT_CHARS = 2_200;
const LAST_TURN_TOOL_EVIDENCE_HEADER =
  "Last turn tool evidence (ground truth for follow-up questions about prior results):";

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
  const timeoutMs = capTimeoutToRuntimeBudget({
    requestedMs: params.timeoutMs,
    minimumMs: 500,
    reserveMs: 200,
  });
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      params.run(),
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new RuntimeOperationTimeoutError(params.operation, timeoutMs));
        }, timeoutMs);
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
    const compact = systemText.replace(/\s+/g, " ").trim();
    const clipped = compact.length > 320 ? `${compact.slice(0, 317)}...` : compact;
    normalized.push({
      role: "assistant",
      content: `Context note: ${clipped}`,
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
  lane: RuntimeLane;
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
  const slotBudget = resolveRuntimeContextSlotBudget(lane);
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
    "Runtime session policy:",
    `- Session lane: ${lane}.`,
    `- User timezone: ${userTimeZone}.`,
    `- Current local time for the user: ${formatNowInTimeZone(userTimeZone)}.`,
    "- Interpret relative dates (today, tomorrow, monday, next week) in the user timezone.",
    "- For inbox/calendar facts, rely on tool evidence; do not guess.",
    "- If prior turn tool evidence is present and still answers the follow-up, reuse it without forcing a new tool call.",
    "- If prior evidence is stale, partial, or missing required scope, call tools to refresh.",
    "- Treat task rescheduling as valid calendar rescheduling when task/calendar tools are available.",
    "- If a tool indicates missing fields, ask one precise follow-up question.",
    "- Keep output concise and natural in assistant voice.",
    ...(contextStatus && contextStatus !== "ready"
      ? [
          `- Runtime memory context status: ${contextStatus}${
            contextIssues.length > 0 ? ` (${contextIssues.join(", ")})` : ""
          }.`,
        ]
      : []),
    ...(contextSection.promptBlock
      ? ["Runtime memory context (read-only):", contextSection.promptBlock]
      : []),
    ...(skillSection ? ["Active skill guidance:", skillSection] : []),
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

function resolveLane(session: RuntimeSession): RuntimeLane {
  if (session.turn.routeHint === "conversation_only" || session.turn.toolChoice === "none") {
    return "conversation_only";
  }
  if (session.turn.routeHint === "evidence_first") {
    return "evidence_first";
  }
  return "planner";
}

function resolveNativeMaxSteps(session: RuntimeSession, lane: RuntimeLane): number {
  const configured = session.userPromptConfig?.maxSteps;
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.min(Math.max(1, Math.trunc(configured)), 24);
  }
  if (lane === "conversation_only") return 1;
  if (lane === "evidence_first") return 4;
  return 8;
}

function resolveNativeTimeoutMs(lane: RuntimeLane): number {
  if (lane === "conversation_only") return 18_000;
  if (lane === "evidence_first") return 60_000;
  return 120_000;
}

function requiresToolEvidenceForFinalAnswer(session: RuntimeSession): boolean {
  if (session.turn.requestedOperation !== "read") return false;
  return (
    session.turn.domain === "inbox" ||
    session.turn.domain === "calendar" ||
    session.turn.domain === "cross_surface"
  );
}

type PriorToolEvidenceEntry = {
  outcome?: "success" | "partial" | "blocked" | "failed";
  evidence?: {
    observedAt?: string;
    coverage?: "complete" | "partial";
    reusableForFollowUp?: boolean;
    staleAfterSec?: number;
  };
};

function parsePriorToolEvidence(content: string): PriorToolEvidenceEntry[] {
  const markerIndex = content.indexOf(LAST_TURN_TOOL_EVIDENCE_HEADER);
  if (markerIndex < 0) return [];
  const payload = content
    .slice(markerIndex + LAST_TURN_TOOL_EVIDENCE_HEADER.length)
    .trim();
  if (!payload) return [];
  try {
    const parsed = JSON.parse(payload);
    return Array.isArray(parsed) ? (parsed as PriorToolEvidenceEntry[]) : [];
  } catch {
    return [];
  }
}

function isReusablePriorEvidenceEntry(entry: PriorToolEvidenceEntry): boolean {
  if (entry.outcome !== "success" && entry.outcome !== "partial") return false;
  if (!entry.evidence || typeof entry.evidence !== "object") return false;
  if (entry.evidence.reusableForFollowUp !== true) return false;
  if (entry.evidence.coverage && entry.evidence.coverage !== "complete") return false;
  if (typeof entry.evidence.observedAt !== "string") return false;
  const observedAtMs = Date.parse(entry.evidence.observedAt);
  if (!Number.isFinite(observedAtMs)) return false;
  const staleAfterSec = entry.evidence.staleAfterSec;
  if (typeof staleAfterSec === "number" && Number.isFinite(staleAfterSec) && staleAfterSec > 0) {
    if (Date.now() - observedAtMs > staleAfterSec * 1_000) {
      return false;
    }
  }
  return true;
}

type PriorTurnToolEvidenceStatus = "missing" | "stale_or_partial" | "reusable";

function resolvePriorTurnToolEvidenceStatus(session: RuntimeSession): PriorTurnToolEvidenceStatus {
  if (!Array.isArray(session.input.messages) || session.input.messages.length === 0) {
    return "missing";
  }

  let foundEvidencePayload = false;

  for (const message of session.input.messages) {
    if (message.role !== "assistant") continue;
    const content = extractMessageTextContent(message.content);
    if (!content.includes(LAST_TURN_TOOL_EVIDENCE_HEADER)) continue;
    foundEvidencePayload = true;
    const entries = parsePriorToolEvidence(content);
    if (entries.some(isReusablePriorEvidenceEntry)) return "reusable";
  }

  return foundEvidencePayload ? "stale_or_partial" : "missing";
}

function resolveGenerationUsage(generation: unknown): RuntimeLoopResult["usage"] | undefined {
  if (!generation || typeof generation !== "object") return undefined;
  const usage =
    "usage" in generation && generation.usage && typeof generation.usage === "object"
      ? (generation.usage as Record<string, unknown>)
      : undefined;
  if (!usage) return undefined;

  const inputTokens =
    typeof usage.inputTokens === "number" && Number.isFinite(usage.inputTokens)
      ? Math.max(0, Math.trunc(usage.inputTokens))
      : 0;
  const outputTokens =
    typeof usage.outputTokens === "number" && Number.isFinite(usage.outputTokens)
      ? Math.max(0, Math.trunc(usage.outputTokens))
      : 0;
  const totalTokens =
    typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens)
      ? Math.max(0, Math.trunc(usage.totalTokens))
      : inputTokens + outputTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export async function runAttemptLoop(session: RuntimeSession): Promise<RuntimeLoopResult> {
  const startedAt = Date.now();

  return runWithRuntimeDeadlineContext(
    {
      startedAtMs: startedAt,
      deadlineMs: startedAt + RUNTIME_TURN_BUDGET_MS,
    },
    async () => {
      const lane = resolveLane(session);
      const nativeMaxSteps = resolveNativeMaxSteps(session, lane);
      const nativeTurnTimeoutMs = resolveNativeTimeoutMs(lane);

      emitRuntimeTelemetry(session.input.logger, "openworld.runtime.route_selected", {
        userId: session.input.userId,
        provider: session.input.provider,
        lane,
        profile: session.turn.routeProfile,
        reason: "session_turn_contract",
        nativeMaxSteps,
        nativeTurnTimeoutMs,
        maxAttempts: 1,
        decisionTimeoutMs: 0,
        toolCatalogLimit: session.toolRegistry.length,
        includeSkillGuidance: true,
      });

      const collectedResults = (): RuntimeToolResult[] =>
        session.summaries.map((summary) => summary.result);

      const composeAssistantReply = async (params: {
        mode: "final" | "clarification" | "approval_pending" | "error";
        fallbackText: string;
      }): Promise<string> => {
        const runWriter = () =>
          generateRuntimeUserReply({
            session,
            request: session.input.message,
            results: collectedResults(),
            approvalsCount: session.artifacts.approvals.length,
            mode: params.mode,
            fallbackText: params.fallbackText,
          });

        try {
          return await withRuntimeTimeout({
            operation: "response_write",
            timeoutMs: 12_000,
            run: runWriter,
          });
        } catch (error) {
          session.input.logger.warn("Runtime response writer failed", {
            error,
            mode: params.mode,
          });
          return "I ran into a temporary issue on my side. Please try again, and I'll pick it up from there.";
        }
      };

      const modelOptions = getModel("economy");
      const generate = createGenerateText({
        emailAccount: {
          id: session.input.emailAccountId,
          email: session.input.email,
          userId: session.input.userId,
        },
        label: "openworld-runtime-session-turn",
        modelOptions,
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
          lane,
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

      const generationTimeoutMs = Math.min(nativeTurnTimeoutMs, budgetBeforeGenerate);

      const runNativeGeneration = (runtimeMessages: ModelMessage[]) =>
        withRuntimeTimeout({
          operation: "native_generate",
          timeoutMs: generationTimeoutMs,
          run: () =>
            runRuntimeSessionRunner({
              generate,
              model: modelOptions.model,
              system: buildNativeRuntimeSystemPrompt({
                session,
                userTimeZone,
                lane,
              }),
              messages: runtimeMessages,
              maxSteps: nativeMaxSteps,
              tools: session.tools,
              toolChoice: session.turn.toolChoice,
            }),
        });

      let generation;
      try {
        generation = await runNativeGeneration(messagesForGeneration);
      } catch (error) {
        session.input.logger.error("Runtime native generation failed", {
          error,
          lane,
          nativeMaxSteps,
          generationTimeoutMs,
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
            lane,
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
              lane,
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
                lane,
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
                lane,
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
      const approvalsCount = session.artifacts.approvals.length;
      const fallbackText = summarizeRuntimeResults({
        request: session.input.message,
        results,
        approvalsCount,
      });

      const finalText = generation.text.trim();
      const clarificationPrompt = latestClarificationPrompt(results);
      const usage = resolveGenerationUsage(generation);
      const hasToolEvidence = session.summaries.length > 0;
      const priorEvidenceStatus = resolvePriorTurnToolEvidenceStatus(session);
      const hasPriorEvidence = priorEvidenceStatus === "reusable";
      const reusedPriorEvidence = hasPriorEvidence && !hasToolEvidence;

      if (session.turn.requestedOperation === "read" && session.turn.followUpLikely) {
        emitRuntimeTelemetry(session.input.logger, "openworld.metric.followup_evidence_reuse", {
          userId: session.input.userId,
          provider: session.input.provider,
          reused: reusedPriorEvidence,
          reason:
            reusedPriorEvidence
              ? "reused"
              : priorEvidenceStatus === "missing"
                ? "missing"
                : "stale_or_partial",
        });
      }

      if (requiresToolEvidenceForFinalAnswer(session) && !hasToolEvidence && !hasPriorEvidence) {
        session.input.logger.warn("Runtime read turn finished without required tool evidence", {
          userId: session.input.userId,
          provider: session.input.provider,
          domain: session.turn.domain,
          requestedOperation: session.turn.requestedOperation,
        });
        return {
          text: await composeAssistantReply({
            mode: "clarification",
            fallbackText:
              "I couldn't verify that yet because I need to run inbox/calendar checks first. Please retry so I can fetch the latest data.",
          }),
          stopReason: "needs_clarification",
          attempts: Math.max(1, generation.steps.length),
          usage,
        };
      }

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
          usage,
        };
      }

      if (clarificationPrompt) {
        return {
          text: await composeAssistantReply({
            mode: "clarification",
            fallbackText,
          }),
          stopReason: "needs_clarification",
          attempts: Math.max(1, generation.steps.length),
          usage,
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
          usage,
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
          usage,
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
        usage,
      };
    },
  );
}
