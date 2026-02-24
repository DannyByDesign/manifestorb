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

function applyDeterministicTurnGuards(
  planned: z.infer<typeof runtimeTurnPlanSchema>,
): z.infer<typeof runtimeTurnPlanSchema> {
  const next: z.infer<typeof runtimeTurnPlanSchema> = {
    ...planned,
    followUpLikely: planned.followUpLikely,
  };

  if (next.requestedOperation === "read") {
    next.toolChoice = "auto";
    if (next.routeHint === "conversation_only") {
      next.routeHint = next.followUpLikely ? "evidence_first" : "planner";
    }
  }

  if (
    (next.requestedOperation === "mutate" || next.requestedOperation === "mixed") &&
    next.routeHint === "conversation_only"
  ) {
    next.routeHint = "planner";
    next.toolChoice = "auto";
  }

  if (next.requestedOperation === "meta" && next.routeHint !== "conversation_only") {
    next.toolChoice = "auto";
  }

  if (next.followUpLikely && next.requestedOperation === "read" && next.routeHint === "planner") {
    next.routeHint = "evidence_first";
  }

  return next;
}

function normalizePlannedTurn(
  planned: z.infer<typeof runtimeTurnPlanSchema>,
): RuntimeTurnContract {
  const guarded = applyDeterministicTurnGuards(planned);
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
        "Use conversation_only + toolChoice none only when the user is clearly not requesting any factual/task action.",
        "For follow-up questions about previous tool results, prefer routeHint evidence_first with requestedOperation read and toolChoice auto.",
        "If uncertain, keep toolChoice auto and set needsClarification true.",
      ].join("\n"),
      prompt: [
        `Provider: ${params.provider}`,
        "User message:",
        trimmed,
      ].join("\n"),
    });
    return normalizePlannedTurn(object);
  } catch (error) {
    params.logger.warn("Runtime turn planner failed; using fallback turn contract", {
      error: error instanceof Error ? error.message : String(error),
      userId: params.userId,
      provider: params.provider,
    });
    return buildFallbackRuntimeTurnContract(trimmed);
  }
}
