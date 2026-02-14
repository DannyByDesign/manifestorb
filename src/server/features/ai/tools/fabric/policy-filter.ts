import type { RuntimeSemanticContract } from "@/server/features/ai/runtime/semantic-contract";
import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";
import { filterToolsByPolicy } from "@/server/features/ai/tools/policy/policy-matcher";
import type { ResolvedLayeredToolPolicies } from "@/server/features/ai/tools/policy/types";
import type { CapabilityIntentFamily } from "@/server/features/ai/tools/runtime/capabilities/registry";

export interface ToolFilterParams {
  includeDangerous?: boolean;
  message?: string;
  strictReadOnly?: boolean;
  semantic?: RuntimeSemanticContract;
  maxTools?: number;
  layeredPolicies?: ResolvedLayeredToolPolicies;
  additionalGroups?: Record<string, string[]>;
}

export interface ToolFilterDiagnostics {
  counts: {
    before: number;
    semanticCandidate: number;
    afterProfile: number;
    afterProviderProfile: number;
    afterGlobal: number;
    afterGlobalProvider: number;
    afterAgent: number;
    afterAgentProvider: number;
    afterGroup: number;
    afterSandbox: number;
    afterSubagent: number;
    afterRisk: number;
    afterLimit: number;
  };
}

const MUTATION_RE =
  /\b(create|update|edit|change|delete|remove|archive|trash|send|reply|move|label|reschedule|book|cancel|block|unsubscribe|mark|snooze)\b/u;
const INBOX_RE = /\b(inbox|email|thread|message|draft|reply|sender)\b/u;
const CALENDAR_RE = /\b(calendar|meeting|event|schedule|availability)\b/u;
const POLICY_RE = /\b(rule|policy|approval|permission|automation|preference)\b/u;

const PROFILE_LIMITS: Record<NonNullable<RuntimeSemanticContract["routeProfile"]>, number> = {
  fast: 12,
  standard: 24,
  deep: 40,
};

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
  params: ToolFilterParams,
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
    if (hints.includes("inbox") && definition.metadata.intentFamilies.some((family) => family.startsWith("inbox_"))) {
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

function semanticCandidateRegistry(
  registry: RuntimeToolDefinition[],
  params: ToolFilterParams,
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

function applyLayeredDeterministicPolicies(
  registry: RuntimeToolDefinition[],
  params: ToolFilterParams,
): { tools: RuntimeToolDefinition[]; diagnostics: ToolFilterDiagnostics } {
  const layers = params.layeredPolicies;
  const groups = params.additionalGroups;
  const diagnostics: ToolFilterDiagnostics = {
    counts: {
      before: registry.length,
      semanticCandidate: registry.length,
      afterProfile: registry.length,
      afterProviderProfile: registry.length,
      afterGlobal: registry.length,
      afterGlobalProvider: registry.length,
      afterAgent: registry.length,
      afterAgentProvider: registry.length,
      afterGroup: registry.length,
      afterSandbox: registry.length,
      afterSubagent: registry.length,
      afterRisk: registry.length,
      afterLimit: registry.length,
    },
  };

  let working = semanticCandidateRegistry(registry, params);
  diagnostics.counts.semanticCandidate = working.length;

  if (!layers) {
    diagnostics.counts.afterProfile = working.length;
    diagnostics.counts.afterProviderProfile = working.length;
    diagnostics.counts.afterGlobal = working.length;
    diagnostics.counts.afterGlobalProvider = working.length;
    diagnostics.counts.afterAgent = working.length;
    diagnostics.counts.afterAgentProvider = working.length;
    diagnostics.counts.afterGroup = working.length;
    diagnostics.counts.afterSandbox = working.length;
    diagnostics.counts.afterSubagent = working.length;
    return { tools: working, diagnostics };
  }

  const apply = (policy: typeof layers.profilePolicy, key: keyof ToolFilterDiagnostics["counts"]) => {
    working = policy ? filterToolsByPolicy(working, policy, groups) : working;
    diagnostics.counts[key] = working.length;
  };

  apply(layers.profilePolicy, "afterProfile");
  apply(layers.providerProfilePolicy, "afterProviderProfile");
  apply(layers.globalPolicy, "afterGlobal");
  apply(layers.globalProviderPolicy, "afterGlobalProvider");
  apply(layers.agentPolicy, "afterAgent");
  apply(layers.agentProviderPolicy, "afterAgentProvider");
  apply(layers.groupPolicy, "afterGroup");
  apply(layers.sandboxPolicy, "afterSandbox");
  apply(layers.subagentPolicy, "afterSubagent");

  return { tools: working, diagnostics };
}

function applyRiskAndLimit(
  registry: RuntimeToolDefinition[],
  params: ToolFilterParams,
  diagnostics: ToolFilterDiagnostics,
): RuntimeToolDefinition[] {
  let working = [...registry];
  if (!params.includeDangerous || params.semantic?.riskLevel !== "high") {
    working = working.filter((definition) => definition.metadata.riskLevel !== "dangerous");
  }
  diagnostics.counts.afterRisk = working.length;

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

  const baseLimit = params.maxTools ?? (params.semantic ? PROFILE_LIMITS[params.semantic.routeProfile] : 24);
  const limit = Math.max(6, Math.min(baseLimit, 48));
  const limited = scored.slice(0, limit);
  diagnostics.counts.afterLimit = limited.length;
  return limited;
}

export function filterToolRegistryDetailed(
  registry: RuntimeToolDefinition[],
  params: ToolFilterParams,
): { tools: RuntimeToolDefinition[]; diagnostics: ToolFilterDiagnostics } {
  const { tools: deterministic, diagnostics } = applyLayeredDeterministicPolicies(registry, params);
  const limited = applyRiskAndLimit(deterministic, params, diagnostics);
  return { tools: limited, diagnostics };
}

export function filterToolRegistry(
  registry: RuntimeToolDefinition[],
  params: ToolFilterParams,
): RuntimeToolDefinition[] {
  return filterToolRegistryDetailed(registry, params).tools;
}
