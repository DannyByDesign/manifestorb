import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import {
  buildFallbackRuntimeTurnContract,
  type RuntimeTurnContract,
} from "@/server/features/ai/runtime/turn-contract";
import type { Logger } from "@/server/lib/logger";

const runtimeTurnPlanSchema = z
  .object({
    intent: z.enum([
      "greeting",
      "capabilities",
      "inbox_read",
      "inbox_attention",
      "inbox_mutation",
      "calendar_read",
      "calendar_mutation",
      "policy_controls",
      "cross_surface_plan",
      "general",
    ]),
    domain: z.enum(["general", "inbox", "calendar", "policy", "cross_surface"]),
    requestedOperation: z.enum(["meta", "read", "mutate", "mixed"]),
    complexity: z.enum(["simple", "moderate", "complex"]),
    routeProfile: z.enum(["fast", "standard", "deep"]),
    routeHint: z.enum(["conversation_only", "evidence_first", "planner"]),
    toolChoice: z.enum(["none", "auto"]),
    knowledgeSource: z.enum(["internal", "web", "either"]).default("either"),
    freshness: z.enum(["low", "high"]).default("low"),
    riskLevel: z.enum(["low", "medium", "high"]),
    confidence: z.number().min(0).max(1),
    toolHints: z.array(z.string().min(1).max(80)).max(16).default([]),
    conversationClauses: z.array(z.string().min(1).max(160)).max(16).default([]),
    taskClauses: z
      .array(
        z
          .object({
            domain: z.string().min(1).max(40),
            action: z.string().min(1).max(80),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(16)
      .default([]),
    metaConstraints: z.array(z.string().min(1).max(120)).max(16).default([]),
    needsClarification: z.boolean().default(false),
    followUpLikely: z.boolean().default(false),
  })
  .strict();

const FOLLOW_UP_CUE_PHRASES = [
  "what about",
  "how about",
  "and",
  "also",
  "again",
  "same",
  "previous",
  "earlier",
  "last one",
  "that",
  "those",
  "it",
  "them",
  "why",
  "how",
] as const;
const FACTUAL_READ_CUE_PHRASES = [
  "unread",
  "email",
  "inbox",
  "mail",
  "calendar",
  "event",
  "meeting",
  "task",
  "count",
  "how many",
  "do i have",
  "did i",
  "get",
  "find",
  "show",
  "today",
  "tomorrow",
  "this week",
] as const;
const PURE_SOCIAL_PHRASES = new Set([
  "hi",
  "hello",
  "hey",
  "yo",
  "sup",
  "thanks",
  "thank you",
  "ok",
  "okay",
  "cool",
  "nice",
  "good morning",
  "good evening",
  "good night",
]);

function normalizeTextForPhraseScan(input: string): string {
  const lower = input.trim().toLowerCase();
  if (!lower) return "";
  let normalized = "";
  let previousWasSpace = false;
  for (const char of lower) {
    const code = char.charCodeAt(0);
    const isAlphaNumeric = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
    if (isAlphaNumeric) {
      normalized += char;
      previousWasSpace = false;
      continue;
    }
    if (!previousWasSpace) {
      normalized += " ";
      previousWasSpace = true;
    }
  }
  return normalized.trim();
}

function containsWholePhrase(normalizedText: string, phrase: string): boolean {
  if (!normalizedText || !phrase) return false;
  if (normalizedText === phrase) return true;
  if (normalizedText.startsWith(`${phrase} `)) return true;
  if (normalizedText.endsWith(` ${phrase}`)) return true;
  return normalizedText.includes(` ${phrase} `);
}

function inferFollowUpLikely(message: string): boolean {
  const normalized = normalizeTextForPhraseScan(message);
  if (!normalized) return false;
  if (FOLLOW_UP_CUE_PHRASES.some((cue) => containsWholePhrase(normalized, cue))) return true;
  if (normalized.length <= 24) {
    const firstToken = normalized.split(" ", 1)[0] ?? "";
    if (["why", "how", "which", "what", "where", "when"].includes(firstToken)) {
      return true;
    }
  }
  if (message.trim().endsWith("?") && normalized.length <= 12) {
    return true;
  }
  return false;
}

function isLikelyFactualRead(message: string): boolean {
  const normalized = normalizeTextForPhraseScan(message);
  if (!normalized) return false;
  if (FACTUAL_READ_CUE_PHRASES.some((cue) => containsWholePhrase(normalized, cue))) return true;
  return normalized.includes("?");
}

function isPureSocialMessage(message: string): boolean {
  const normalized = normalizeTextForPhraseScan(message);
  if (!normalized) return false;
  return PURE_SOCIAL_PHRASES.has(normalized);
}

function applyDeterministicTurnGuards(
  planned: z.infer<typeof runtimeTurnPlanSchema>,
  message: string,
): z.infer<typeof runtimeTurnPlanSchema> {
  const normalizedMessage = message.trim();
  const followUpLikely = planned.followUpLikely || inferFollowUpLikely(normalizedMessage);
  const likelyFactualRead = isLikelyFactualRead(normalizedMessage) || followUpLikely;
  const pureSocial = isPureSocialMessage(normalizedMessage);

  const next: z.infer<typeof runtimeTurnPlanSchema> = {
    ...planned,
    followUpLikely,
  };

  if (
    (next.intent === "greeting" || next.intent === "capabilities") &&
    pureSocial &&
    !followUpLikely
  ) {
    return {
      ...next,
      requestedOperation: "meta",
      routeHint: "conversation_only",
      toolChoice: "none",
    };
  }

  if (next.requestedOperation === "meta" && likelyFactualRead) {
    next.requestedOperation = "read";
    next.metaConstraints = Array.from(
      new Set([...next.metaConstraints, "meta_recast_to_read"]),
    ).slice(0, 16);
  }

  if (next.requestedOperation === "read") {
    next.toolChoice = "auto";
    if (next.routeHint === "conversation_only") {
      next.routeHint = followUpLikely ? "evidence_first" : "planner";
    }
  }

  if (followUpLikely && next.requestedOperation === "read" && next.routeHint === "planner") {
    next.routeHint = "evidence_first";
  }

  return next;
}

function normalizePlannedTurn(
  planned: z.infer<typeof runtimeTurnPlanSchema>,
  message: string,
): RuntimeTurnContract {
  const guarded = applyDeterministicTurnGuards(planned, message);
  return {
    ...guarded,
    source: "model",
  };
}

export async function planRuntimeTurn(params: {
  userId: string;
  emailAccountId: string;
  email: string;
  provider: string;
  message: string;
  logger: Logger;
}): Promise<RuntimeTurnContract> {
  const trimmed = params.message.trim();
  if (!trimmed) return buildFallbackRuntimeTurnContract(trimmed);

  const modelOptions = getModel("economy");
  const generate = createGenerateObject({
    emailAccount: {
      id: params.emailAccountId,
      email: params.email,
      userId: params.userId,
    },
    label: "openworld-runtime-turn-plan",
    modelOptions,
    maxLLMRetries: 0,
  });

  try {
    const { object } = await generate({
      model: modelOptions.model,
      schema: runtimeTurnPlanSchema,
      system: [
        "You are the runtime turn planner for an autonomous inbox/calendar agent.",
        "Output JSON only matching the schema.",
        "Classify user intent and operation for tool orchestration.",
        "When user asks factual inbox/calendar questions, set requestedOperation to read and toolChoice to auto.",
        "Use conversation_only + toolChoice none only for pure social/greeting/capability chatter.",
        "For follow-up questions about previous tool results, prefer routeHint evidence_first with requestedOperation read and toolChoice auto.",
        "If uncertain, keep toolChoice auto and set needsClarification true.",
      ].join("\n"),
      prompt: [
        `Provider: ${params.provider}`,
        "User message:",
        trimmed,
      ].join("\n"),
    });
    return normalizePlannedTurn(object, trimmed);
  } catch (error) {
    params.logger.warn("Runtime turn planner failed; using fallback turn contract", {
      error: error instanceof Error ? error.message : String(error),
      userId: params.userId,
      provider: params.provider,
    });
    return buildFallbackRuntimeTurnContract(trimmed);
  }
}
