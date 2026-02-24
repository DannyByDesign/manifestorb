export type RuntimeTurnIntent =
  | "greeting"
  | "capabilities"
  | "inbox_read"
  | "inbox_attention"
  | "inbox_mutation"
  | "calendar_read"
  | "calendar_mutation"
  | "policy_controls"
  | "cross_surface_plan"
  | "general";

export type RuntimeTurnDomain =
  | "general"
  | "inbox"
  | "calendar"
  | "policy"
  | "cross_surface";

export type RuntimeRequestedOperation = "meta" | "read" | "mutate" | "mixed";
export type RuntimeComplexity = "simple" | "moderate" | "complex";
export type RuntimeRouteProfile = "fast" | "standard" | "deep";
export type RuntimeRiskLevel = "low" | "medium" | "high";
export type RuntimeTurnSource = "model" | "fallback";

export interface RuntimeTurnContract {
  intent: RuntimeTurnIntent;
  domain: RuntimeTurnDomain;
  requestedOperation: RuntimeRequestedOperation;
  complexity: RuntimeComplexity;
  routeProfile: RuntimeRouteProfile;
  routeHint: "conversation_only" | "planner";
  toolChoice: "none" | "auto";
  knowledgeSource: "internal" | "web" | "either";
  freshness: "low" | "high";
  riskLevel: RuntimeRiskLevel;
  confidence: number;
  toolHints: string[];
  source: RuntimeTurnSource;
  conversationClauses: string[];
  taskClauses: Array<{ domain: string; action: string; confidence: number }>;
  metaConstraints: string[];
  needsClarification: boolean;
  followUpLikely: boolean;
}

export function buildFallbackRuntimeTurnContract(message: string): RuntimeTurnContract {
  const normalized = message.trim();
  const conversationOnly = normalized.length === 0;
  return {
    intent: conversationOnly ? "greeting" : "general",
    domain: "general",
    requestedOperation: conversationOnly ? "meta" : "read",
    complexity: "moderate",
    routeProfile: "standard",
    routeHint: conversationOnly ? "conversation_only" : "planner",
    toolChoice: conversationOnly ? "none" : "auto",
    knowledgeSource: "either",
    freshness: "low",
    riskLevel: "low",
    confidence: 0.15,
    toolHints: [],
    source: "fallback",
    conversationClauses: [],
    taskClauses: [],
    metaConstraints: ["model_turn_planner_unavailable"],
    needsClarification: !conversationOnly,
    followUpLikely: false,
  };
}
