import type { RuntimeTurnContract } from "@/server/features/ai/runtime/turn-contract";
import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";
import type { CapabilityIntentFamily } from "@/server/features/ai/tools/runtime/capabilities/registry";
import { EmbeddingService } from "@/server/features/memory/embeddings/service";

export interface SemanticToolCandidateParams {
  strictReadOnly?: boolean;
  turn?: RuntimeTurnContract;
}

export interface ToolRankingParams {
  includeDangerous?: boolean;
  maxTools?: number;
  message?: string;
  embeddingEmail?: string;
  turn?: RuntimeTurnContract;
}

const MUTATION_RE =
  /\b(create|update|edit|change|delete|remove|archive|trash|send|reply|move|label|reschedule|book|cancel|block|unsubscribe|mark|snooze)\b/u;
const INBOX_RE = /\b(inbox|email|thread|message|draft|reply|sender)\b/u;
const CALENDAR_RE =
  /\b(calendar|meeting|event|schedule|availability|task|tasks|todo|to-do)\b/u;
const POLICY_RE = /\b(rule|policy|approval|permission|automation|preference)\b/u;
const MEMORY_RE =
  /\b(remember|memory|recall|forgot|forget|last time|history|relationship|contact context)\b/u;

const PROFILE_LIMITS: Record<NonNullable<RuntimeTurnContract["routeProfile"]>, number> = {
  fast: 20,
  standard: 48,
  deep: 72,
};

function resolveAdaptiveToolLimit(params: ToolRankingParams): number {
  const turn = params.turn;
  const baseLimit = params.maxTools ?? (turn ? PROFILE_LIMITS[turn.routeProfile] : 32);
  let adjusted = baseLimit;

  if (turn) {
    if (turn.domain === "cross_surface" || turn.requestedOperation === "mixed") {
      adjusted += 16;
    }
    if (turn.complexity === "complex") {
      adjusted += 12;
    } else if (turn.complexity === "moderate") {
      adjusted += 6;
    }
  }

  return Math.min(Math.max(adjusted, 8), 96);
}

function intersectsIntentFamily(
  definition: RuntimeToolDefinition,
  families: CapabilityIntentFamily[],
): boolean {
  return definition.metadata.intentFamilies.some((family) => families.includes(family));
}

function familiesForSemanticContract(
  turn: RuntimeTurnContract,
): CapabilityIntentFamily[] {
  const op = turn.requestedOperation;
  switch (turn.domain) {
    case "inbox":
      return op === "read"
        ? ["inbox_read", "cross_surface_planning", "memory_read"]
        : ["inbox_read", "inbox_mutate", "inbox_compose", "inbox_controls", "cross_surface_planning", "memory_read", "memory_mutate"];
    case "calendar":
      return op === "read"
        ? ["calendar_read", "cross_surface_planning", "memory_read"]
        : ["calendar_read", "calendar_mutate", "calendar_policy", "cross_surface_planning", "memory_read", "memory_mutate"];
    case "policy":
      return ["calendar_policy", "cross_surface_planning"];
    case "cross_surface":
      return [
        "inbox_read",
        "inbox_mutate",
        "inbox_compose",
        "inbox_controls",
        "calendar_read",
        "calendar_mutate",
        "calendar_policy",
        "cross_surface_planning",
        "memory_read",
        "memory_mutate",
      ];
    case "general":
      return [];
    default:
      return [];
  }
}

function lexicalDomainHints(message: string): Array<"inbox" | "calendar" | "policy" | "memory"> {
  const hints: Array<"inbox" | "calendar" | "policy" | "memory"> = [];
  if (INBOX_RE.test(message)) hints.push("inbox");
  if (CALENDAR_RE.test(message)) hints.push("calendar");
  if (POLICY_RE.test(message)) hints.push("policy");
  if (MEMORY_RE.test(message)) hints.push("memory");
  return hints;
}

function scoreToolRelevance(
  definition: RuntimeToolDefinition,
  params: ToolRankingParams,
): number {
  const message = (params.message ?? "").toLowerCase();
  const turn = params.turn;
  const tags = definition.metadata.tags;
  let score = 0;

  if (turn) {
    const families = familiesForSemanticContract(turn);
    if (families.length > 0 && intersectsIntentFamily(definition, families)) score += 8;
    if (turn.requestedOperation === "read" && definition.metadata.readOnly) score += 5;
    if (
      turn.requestedOperation !== "read" &&
      turn.requestedOperation !== "meta" &&
      !definition.metadata.readOnly
    ) {
      score += 4;
    }
  }

  if (message.length > 0) {
    for (const tag of tags) {
      if (message.includes(tag.toLowerCase())) score += 1;
    }

    const hints = lexicalDomainHints(message);
    if (
      hints.includes("inbox") &&
      definition.metadata.intentFamilies.some((family) => family.startsWith("inbox_"))
    ) {
      score += 3;
    }

    if (
      hints.includes("calendar") &&
      definition.metadata.intentFamilies.some((family) => family.startsWith("calendar_"))
    ) {
      score += 3;
    }

    if (
      hints.includes("policy") &&
      (definition.metadata.intentFamilies.includes("calendar_policy") ||
        definition.metadata.intentFamilies.includes("cross_surface_planning"))
    ) {
      score += 2;
    }

    if (
      hints.includes("memory") &&
      definition.metadata.intentFamilies.some(
        (family) => family === "memory_read" || family === "memory_mutate",
      )
    ) {
      score += 4;
    }

    const mutating = MUTATION_RE.test(message);
    if (mutating && !definition.metadata.readOnly) score += 2;
    if (!mutating && definition.metadata.readOnly) score += 2;
  }

  return score;
}

function buildToolEmbeddingText(definition: RuntimeToolDefinition): string {
  const tags = definition.metadata.tags?.length ? definition.metadata.tags.join(", ") : "";
  const families = definition.metadata.intentFamilies?.length
    ? definition.metadata.intentFamilies.join(", ")
    : "";
  return [
    `tool: ${definition.toolName}`,
    `description: ${definition.description}`,
    tags ? `tags: ${tags}` : "",
    families ? `intentFamilies: ${families}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function shouldUseSemanticToolRanking(message: string): boolean {
  if (!message) return false;
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") return false;
  if (process.env.RUNTIME_TOOL_RANKING_MODE === "lexical") return false;
  return EmbeddingService.isAvailable();
}

export function selectSemanticToolCandidates(
  registry: RuntimeToolDefinition[],
  params: SemanticToolCandidateParams,
): RuntimeToolDefinition[] {
  const turn = params.turn;
  if (!turn) return registry;
  if (turn.intent === "greeting" || turn.intent === "capabilities") return [];
  if (turn.requestedOperation === "meta") return [];

  let working = [...registry];
  const semanticFamilies = familiesForSemanticContract(turn);
  if (semanticFamilies.length > 0) {
    const familyFiltered = working.filter((definition) =>
      intersectsIntentFamily(definition, semanticFamilies),
    );
    if (familyFiltered.length > 0) {
      working = familyFiltered;
    }
  }

  if (turn.requestedOperation === "read" || params.strictReadOnly) {
    const readOnly = working.filter((definition) => definition.metadata.readOnly);
    if (readOnly.length > 0) {
      working = readOnly;
    }
  }

  return working;
}

export function rankAndLimitTools(
  registry: RuntimeToolDefinition[],
  params: ToolRankingParams,
): { tools: RuntimeToolDefinition[]; afterRisk: number; afterLimit: number } {
  let working = [...registry];

  if (!params.includeDangerous || params.turn?.riskLevel !== "high") {
    working = working.filter((definition) => definition.metadata.riskLevel !== "dangerous");
  }
  const afterRisk = working.length;

  const scored = working
    .map((definition, index) => ({
      definition,
      index,
      score: scoreToolRelevance(definition, params),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .map((entry) => entry.definition);

  const limit = resolveAdaptiveToolLimit(params);
  const limited = scored.slice(0, limit);

  return {
    tools: limited,
    afterRisk,
    afterLimit: limited.length,
  };
}

export async function rankAndLimitToolsAsync(
  registry: RuntimeToolDefinition[],
  params: ToolRankingParams,
): Promise<{ tools: RuntimeToolDefinition[]; afterRisk: number; afterLimit: number }> {
  // Keep existing deterministic risk pruning semantics.
  let working = [...registry];
  if (!params.includeDangerous || params.turn?.riskLevel !== "high") {
    working = working.filter((definition) => definition.metadata.riskLevel !== "dangerous");
  }
  const afterRisk = working.length;

  const limit = resolveAdaptiveToolLimit(params);
  if (working.length <= 1 || limit <= 1) {
    const limited = working.slice(0, limit);
    return { tools: limited, afterRisk, afterLimit: limited.length };
  }

  const message = (params.message ?? "").trim();
  const useSemantic = shouldUseSemanticToolRanking(message);

  if (!useSemantic) {
    const fallback = rankAndLimitTools(working, params);
    return fallback;
  }

  try {
    const queryEmbedding = await EmbeddingService.generateEmbedding(message, params.embeddingEmail);
    const toolTexts = working.map(buildToolEmbeddingText);
    const toolEmbeddings = await EmbeddingService.generateEmbeddings(toolTexts, params.embeddingEmail);

    const scored = working
      .map((definition, index) => {
        const baseScore = scoreToolRelevance(definition, params);
        const embedding = toolEmbeddings[index];
        const similarity = embedding
          ? EmbeddingService.cosineSimilarity(queryEmbedding, embedding)
          : 0;
        // Similarity is [-1, 1]. Clamp negatives and scale to play nicely with the existing scoring.
        const semanticScore = Math.max(0, similarity) * 12;
        return {
          definition,
          index,
          score: baseScore + semanticScore,
        };
      })
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.index - right.index;
      })
      .map((entry) => entry.definition);

    const limited = scored.slice(0, limit);
    return { tools: limited, afterRisk, afterLimit: limited.length };
  } catch {
    // If embeddings are misconfigured or temporarily unavailable, fall back to the deterministic lexical scorer.
    return rankAndLimitTools(working, params);
  }
}
