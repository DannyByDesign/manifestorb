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
  source: "deterministic";
  conversationClauses: string[];
  taskClauses: Array<{ domain: string; action: string; confidence: number }>;
  metaConstraints: string[];
  needsClarification: boolean;
}

const GREETING_ONLY_RE =
  /^(?:hi|hello|hey|yo|sup|good\s+(?:morning|afternoon|evening)|howdy|thanks|thank you)[!. ]*$/iu;
const INBOX_KEYWORD_RE =
  /\b(inbox|email|emails|thread|threads|message|messages|draft|drafts|unread|sent)\b/iu;
const CALENDAR_KEYWORD_RE =
  /\b(calendar|event|events|meeting|meetings|availability|schedule|reschedule|time slot|timeslot|task|tasks)\b/iu;
const POLICY_KEYWORD_RE = /\b(policy|rule|rules|approval|guardrail|automation)\b/iu;
const READ_VERB_RE =
  /\b(find|show|list|search|get|check|count|summarize|what(?:'s| is)?|when(?:'s| is)?|which)\b/iu;
const MUTATE_VERB_RE =
  /\b(create|draft|send|reply|forward|delete|remove|trash|archive|unsubscribe|move|set|update|change|reschedule|schedule|block|allow|enable|disable)\b/iu;

export function buildRuntimeTurnContractFromMessage(message: string): RuntimeTurnContract {
  const normalized = message.trim();
  const greetingOnly = GREETING_ONLY_RE.test(normalized);
  const hasReadVerb = READ_VERB_RE.test(normalized);
  const hasMutateVerb = MUTATE_VERB_RE.test(normalized);

  const requestedOperation: RuntimeRequestedOperation = greetingOnly
    ? "meta"
    : hasMutateVerb && hasReadVerb
      ? "mixed"
      : hasMutateVerb
        ? "mutate"
        : hasReadVerb
          ? "read"
          : "meta";

  const domain: RuntimeTurnDomain = POLICY_KEYWORD_RE.test(normalized)
    ? "policy"
    : INBOX_KEYWORD_RE.test(normalized) && CALENDAR_KEYWORD_RE.test(normalized)
      ? "cross_surface"
      : INBOX_KEYWORD_RE.test(normalized)
        ? "inbox"
        : CALENDAR_KEYWORD_RE.test(normalized)
          ? "calendar"
          : "general";

  const complexity: RuntimeComplexity =
    requestedOperation === "mixed" || domain === "cross_surface"
      ? "complex"
      : requestedOperation === "mutate"
        ? "moderate"
        : "simple";

  const routeProfile: RuntimeRouteProfile =
    complexity === "complex" ? "deep" : complexity === "moderate" ? "standard" : "fast";

  const riskLevel: RuntimeRiskLevel =
    requestedOperation === "meta" || requestedOperation === "read"
      ? "low"
      : requestedOperation === "mixed"
        ? "high"
        : "medium";

  const intent: RuntimeTurnIntent =
    domain === "inbox"
      ? requestedOperation === "mutate" || requestedOperation === "mixed"
        ? "inbox_mutation"
        : "inbox_read"
      : domain === "calendar"
        ? requestedOperation === "mutate" || requestedOperation === "mixed"
          ? "calendar_mutation"
          : "calendar_read"
        : domain === "policy"
          ? "policy_controls"
          : domain === "cross_surface"
            ? "cross_surface_plan"
            : greetingOnly
              ? "greeting"
              : "general";

  return {
    intent,
    domain,
    requestedOperation,
    complexity,
    routeProfile,
    routeHint: greetingOnly ? "conversation_only" : "planner",
    toolChoice: greetingOnly ? "none" : "auto",
    knowledgeSource: "either",
    freshness: "low",
    riskLevel,
    confidence: 0.65,
    toolHints: [],
    source: "deterministic",
    conversationClauses: [],
    taskClauses: [],
    metaConstraints: [],
    needsClarification: false,
  };
}
