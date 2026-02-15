import type { RuntimeSemanticContract } from "@/server/features/ai/runtime/semantic-contract";
import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";
import type { CapabilityIntentFamily } from "@/server/features/ai/tools/runtime/capabilities/registry";

export interface SemanticToolCandidateParams {
  strictReadOnly?: boolean;
  semantic?: RuntimeSemanticContract;
}

export interface ToolRankingParams {
  includeDangerous?: boolean;
  maxTools?: number;
  message?: string;
  semantic?: RuntimeSemanticContract;
}

const MUTATION_RE =
  /\b(create|update|edit|change|delete|remove|archive|trash|send|reply|move|label|reschedule|book|cancel|block|unsubscribe|mark|snooze)\b/u;
const INBOX_RE = /\b(inbox|email|thread|message|draft|reply|sender)\b/u;
const CALENDAR_RE =
  /\b(calendar|meeting|event|schedule|availability|task|tasks|todo|to-do)\b/u;
const POLICY_RE = /\b(rule|policy|approval|permission|automation|preference)\b/u;

const PROFILE_LIMITS: Record<NonNullable<RuntimeSemanticContract["routeProfile"]>, number> = {
  fast: 20,
  standard: 48,
  deep: 72,
};

function resolveAdaptiveToolLimit(params: ToolRankingParams): number {
  const semantic = params.semantic;
  const baseLimit = params.maxTools ?? (semantic ? PROFILE_LIMITS[semantic.routeProfile] : 32);
  let adjusted = baseLimit;

  if (semantic) {
    if (semantic.domain === "cross_surface" || semantic.requestedOperation === "mixed") {
      adjusted += 16;
    }
    if (semantic.complexity === "complex") {
      adjusted += 12;
    } else if (semantic.complexity === "moderate") {
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
  semantic: RuntimeSemanticContract,
): CapabilityIntentFamily[] {
  const op = semantic.requestedOperation;
  switch (semantic.domain) {
    case "inbox":
      return op === "read"
        ? ["inbox_read", "cross_surface_planning"]
        : ["inbox_read", "inbox_mutate", "inbox_compose", "inbox_controls", "cross_surface_planning"];
    case "calendar":
      return op === "read"
        ? ["calendar_read", "cross_surface_planning"]
        : ["calendar_read", "calendar_mutate", "calendar_policy", "cross_surface_planning"];
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
      ];
    case "general":
      return [];
    default:
      return [];
  }
}

function lexicalDomainHints(message: string): Array<"inbox" | "calendar" | "policy"> {
  const hints: Array<"inbox" | "calendar" | "policy"> = [];
  if (INBOX_RE.test(message)) hints.push("inbox");
  if (CALENDAR_RE.test(message)) hints.push("calendar");
  if (POLICY_RE.test(message)) hints.push("policy");
  return hints;
}

function scoreToolRelevance(
  definition: RuntimeToolDefinition,
  params: ToolRankingParams,
): number {
  const message = (params.message ?? "").toLowerCase();
  const semantic = params.semantic;
  const tags = definition.metadata.tags;
  let score = 0;

  if (semantic) {
    const families = familiesForSemanticContract(semantic);
    if (families.length > 0 && intersectsIntentFamily(definition, families)) score += 8;
    if (semantic.requestedOperation === "read" && definition.metadata.readOnly) score += 5;
    if (
      semantic.requestedOperation !== "read" &&
      semantic.requestedOperation !== "meta" &&
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

    const mutating = MUTATION_RE.test(message);
    if (mutating && !definition.metadata.readOnly) score += 2;
    if (!mutating && definition.metadata.readOnly) score += 2;
  }

  return score;
}

export function selectSemanticToolCandidates(
  registry: RuntimeToolDefinition[],
  params: SemanticToolCandidateParams,
): RuntimeToolDefinition[] {
  const semantic = params.semantic;
  if (!semantic) return registry;
  if (semantic.intent === "greeting" || semantic.intent === "capabilities") return [];
  if (semantic.requestedOperation === "meta") return [];

  let working = [...registry];
  const semanticFamilies = familiesForSemanticContract(semantic);
  if (semanticFamilies.length > 0) {
    const familyFiltered = working.filter((definition) =>
      intersectsIntentFamily(definition, semanticFamilies),
    );
    if (familyFiltered.length > 0) {
      working = familyFiltered;
    }
  }

  if (semantic.requestedOperation === "read" || params.strictReadOnly) {
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

  if (!params.includeDangerous || params.semantic?.riskLevel !== "high") {
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
