import { EmbeddingService } from "@/server/features/memory/embeddings/service";
import { createScopedLogger, type Logger } from "@/server/lib/logger";

export type RuntimeSemanticIntent =
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

export type RuntimeSemanticDomain =
  | "general"
  | "inbox"
  | "calendar"
  | "policy"
  | "cross_surface";

export type RuntimeRequestedOperation = "meta" | "read" | "mutate" | "mixed";
export type RuntimeComplexity = "simple" | "moderate" | "complex";
export type RuntimeRouteProfile = "fast" | "standard" | "deep";
export type RuntimeRiskLevel = "low" | "medium" | "high";

export interface RuntimeSemanticContract {
  intent: RuntimeSemanticIntent;
  domain: RuntimeSemanticDomain;
  requestedOperation: RuntimeRequestedOperation;
  complexity: RuntimeComplexity;
  routeProfile: RuntimeRouteProfile;
  riskLevel: RuntimeRiskLevel;
  confidence: number;
  toolHints: string[];
  source: "embedding" | "lexical";
  classifier?: {
    topIntent: RuntimeSemanticIntent;
    topScore: number;
    secondIntent: RuntimeSemanticIntent;
    secondScore: number;
    margin: number;
  };
}

const logger = createScopedLogger("RuntimeSemantic");
const ENABLED_SEMANTIC_ROUTING =
  process.env.VITEST !== "true" && process.env.NODE_ENV !== "test";
const SEMANTIC_TIMEOUT_MIN_MS = 1_200;
const SEMANTIC_TIMEOUT_MAX_MS = 4_000;
const MIN_SEMANTIC_SCORE = 0.76;

function resolveSemanticTimeoutMs(message: string): number {
  const envTimeoutRaw = process.env.RUNTIME_SEMANTIC_TIMEOUT_MS;
  if (typeof envTimeoutRaw === "string" && envTimeoutRaw.trim().length > 0) {
    const envTimeout = Number.parseInt(envTimeoutRaw, 10);
    if (Number.isFinite(envTimeout)) {
      return Math.min(Math.max(envTimeout, SEMANTIC_TIMEOUT_MIN_MS), SEMANTIC_TIMEOUT_MAX_MS);
    }
  }
  // Scale timeout with message length to avoid premature fallbacks on long inputs.
  const scaled = SEMANTIC_TIMEOUT_MIN_MS + Math.min(message.length, 2_800);
  return Math.min(Math.max(scaled, SEMANTIC_TIMEOUT_MIN_MS), SEMANTIC_TIMEOUT_MAX_MS);
}

const MUTATION_RE =
  /\b(create|update|edit|change|delete|remove|archive|trash|send|reply|move|label|reschedule|book|cancel|block|unsubscribe|mark|snooze)\b/u;
const DANGEROUS_MUTATION_RE =
  /\b(delete|trash|block|unsubscribe|cancel all|remove all|archive all)\b/u;
const CONDITIONAL_RE = /\b(if|unless|otherwise|except|only if|when)\b/u;
const CHAINING_RE = /\b(and then|then|also|plus|follow(?:ed)? by|after that|before that|next)\b/u;
const EMAIL_RE = /\b(email|emails|inbox|message|messages|thread|threads|draft|drafts)\b/u;
const CALENDAR_RE = /\b(calendar|meeting|meetings|event|events|schedule|availability)\b/u;
const POLICY_RE = /\b(rule|rules|approval|policy|permission|automation|automations|preference|preferences)\b/u;
const GREETING_RE =
  /^(hi|hello|hey|yo|sup|good morning|good afternoon|good evening|howdy)[\s!.?]*$/u;
const CAPABILITIES_RE =
  /\b(what can you do|capabilit(?:y|ies)|how can you help|what do you do|help me understand)\b/u;
const ATTENTION_RE = /\b(unread|need attention|needs attention|respond to|reply to|priority)\b/u;

const INTENT_EXAMPLES: Record<RuntimeSemanticIntent, string[]> = {
  greeting: ["hello", "hi", "good morning", "hey there"],
  capabilities: [
    "what can you do for me",
    "what are your capabilities",
    "how can you help me",
    "what do you handle",
  ],
  inbox_read: [
    "show me my latest email",
    "find the first message in my inbox",
    "what is the newest email",
    "check my inbox",
  ],
  inbox_attention: [
    "what emails need my attention today",
    "which emails should i reply to",
    "show unread priority messages",
    "what inbox items need a response",
  ],
  inbox_mutation: [
    "archive these threads",
    "send a reply to this message",
    "label these inbox items",
    "trash promotional emails",
  ],
  calendar_read: [
    "what meetings do i have today",
    "show my calendar for monday",
    "list my schedule tomorrow",
    "what events are on my calendar",
  ],
  calendar_mutation: [
    "reschedule my meeting to tomorrow",
    "cancel today's meetings",
    "create a calendar event tomorrow at 3pm",
    "move all afternoon meetings",
  ],
  policy_controls: [
    "update my approval settings",
    "create an automation rule",
    "change my assistant policy",
    "what policy is active for deletions",
  ],
  cross_surface_plan: [
    "find important emails and schedule follow ups",
    "reschedule meetings and email everyone",
    "review inbox then update my calendar",
    "plan my day across inbox and calendar",
  ],
  general: [
    "help me with this",
    "what should i do next",
    "i need help",
    "can you assist me",
  ],
};

let centroidPromise: Promise<Record<RuntimeSemanticIntent, number[]>> | null = null;

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dimension = vectors[0]?.length ?? 0;
  const out = new Array<number>(dimension).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < dimension; i += 1) {
      out[i] += vector[i] ?? 0;
    }
  }
  for (let i = 0; i < dimension; i += 1) {
    out[i] /= vectors.length;
  }
  return out;
}

async function buildIntentCentroids(): Promise<Record<RuntimeSemanticIntent, number[]>> {
  const intents = Object.keys(INTENT_EXAMPLES) as RuntimeSemanticIntent[];
  const samples: string[] = [];
  const sampleIntents: RuntimeSemanticIntent[] = [];
  for (const intent of intents) {
    for (const sample of INTENT_EXAMPLES[intent]) {
      samples.push(sample);
      sampleIntents.push(intent);
    }
  }

  const embeddings = await EmbeddingService.generateEmbeddings(samples, undefined, false);
  const grouped: Record<RuntimeSemanticIntent, number[][]> = {
    greeting: [],
    capabilities: [],
    inbox_read: [],
    inbox_attention: [],
    inbox_mutation: [],
    calendar_read: [],
    calendar_mutation: [],
    policy_controls: [],
    cross_surface_plan: [],
    general: [],
  };
  for (let i = 0; i < embeddings.length; i += 1) {
    grouped[sampleIntents[i]].push(embeddings[i]);
  }

  return {
    greeting: averageVectors(grouped.greeting),
    capabilities: averageVectors(grouped.capabilities),
    inbox_read: averageVectors(grouped.inbox_read),
    inbox_attention: averageVectors(grouped.inbox_attention),
    inbox_mutation: averageVectors(grouped.inbox_mutation),
    calendar_read: averageVectors(grouped.calendar_read),
    calendar_mutation: averageVectors(grouped.calendar_mutation),
    policy_controls: averageVectors(grouped.policy_controls),
    cross_surface_plan: averageVectors(grouped.cross_surface_plan),
    general: averageVectors(grouped.general),
  };
}

async function getIntentCentroids(): Promise<Record<RuntimeSemanticIntent, number[]>> {
  if (!centroidPromise) {
    centroidPromise = buildIntentCentroids().catch((error) => {
      centroidPromise = null;
      throw error;
    });
  }
  return centroidPromise;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`semantic_timeout:${timeoutMs}`)), timeoutMs);
    }),
  ]);
}

function intentSeed(intent: RuntimeSemanticIntent): {
  domain: RuntimeSemanticDomain;
  requestedOperation: RuntimeRequestedOperation;
} {
  switch (intent) {
    case "greeting":
    case "capabilities":
      return { domain: "general", requestedOperation: "meta" };
    case "inbox_read":
    case "inbox_attention":
      return { domain: "inbox", requestedOperation: "read" };
    case "inbox_mutation":
      return { domain: "inbox", requestedOperation: "mutate" };
    case "calendar_read":
      return { domain: "calendar", requestedOperation: "read" };
    case "calendar_mutation":
      return { domain: "calendar", requestedOperation: "mutate" };
    case "policy_controls":
      return { domain: "policy", requestedOperation: "mixed" };
    case "cross_surface_plan":
      return { domain: "cross_surface", requestedOperation: "mixed" };
    case "general":
      return { domain: "general", requestedOperation: "read" };
    default:
      return { domain: "general", requestedOperation: "read" };
  }
}

function inferComplexity(message: string, requestedOperation: RuntimeRequestedOperation): RuntimeComplexity {
  const tokens = message.split(/\s+/u).filter(Boolean).length;
  const hasConditional = CONDITIONAL_RE.test(message);
  const chainingCount = [...message.matchAll(new RegExp(CHAINING_RE.source, "gu"))].length;

  if (tokens > 45 || hasConditional || chainingCount >= 2) return "complex";
  if (tokens > 20 || requestedOperation === "mutate" || chainingCount === 1) return "moderate";
  return "simple";
}

function inferRouteProfile(
  intent: RuntimeSemanticIntent,
  complexity: RuntimeComplexity,
  requestedOperation: RuntimeRequestedOperation,
): RuntimeRouteProfile {
  if (intent === "greeting" || intent === "capabilities") return "fast";
  if (intent === "cross_surface_plan" || complexity === "complex") return "deep";
  if (complexity === "moderate" || requestedOperation === "mutate") return "standard";
  return "fast";
}

function inferRiskLevel(message: string, requestedOperation: RuntimeRequestedOperation): RuntimeRiskLevel {
  if (requestedOperation === "meta" || requestedOperation === "read") return "low";
  if (DANGEROUS_MUTATION_RE.test(message)) return "high";
  return "medium";
}

function buildToolHints(
  domain: RuntimeSemanticDomain,
  requestedOperation: RuntimeRequestedOperation,
): string[] {
  const hints = new Set<string>();
  if (domain === "inbox" || domain === "cross_surface") {
    hints.add("group:inbox_read");
    if (requestedOperation !== "read") hints.add("group:inbox_mutate");
  }
  if (domain === "calendar" || domain === "cross_surface") {
    hints.add("group:calendar_read");
    if (requestedOperation !== "read") hints.add("group:calendar_mutate");
  }
  if (domain === "policy" || domain === "cross_surface") {
    hints.add("group:calendar_policy");
  }
  if (domain === "cross_surface") {
    hints.add("group:cross_surface_planning");
  }
  return [...hints];
}

function buildContractFromIntent(params: {
  message: string;
  intent: RuntimeSemanticIntent;
  confidence: number;
  source: "embedding" | "lexical";
  classifier?: RuntimeSemanticContract["classifier"];
}): RuntimeSemanticContract {
  const { message, intent, confidence, source } = params;
  const normalized = message.toLowerCase();
  const seed = intentSeed(intent);
  const complexity = inferComplexity(normalized, seed.requestedOperation);
  const routeProfile = inferRouteProfile(intent, complexity, seed.requestedOperation);
  const riskLevel = inferRiskLevel(normalized, seed.requestedOperation);

  return {
    intent,
    domain: seed.domain,
    requestedOperation: seed.requestedOperation,
    complexity,
    routeProfile,
    riskLevel,
    confidence: Number(confidence.toFixed(4)),
    toolHints: buildToolHints(seed.domain, seed.requestedOperation),
    source,
    ...(params.classifier ? { classifier: params.classifier } : {}),
  };
}

interface IntentScoreEntry {
  intent: RuntimeSemanticIntent;
  score: number;
}

export function rankSemanticIntentScores(
  entries: IntentScoreEntry[],
): {
  top: IntentScoreEntry;
  second: IntentScoreEntry;
  margin: number;
} | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const second = sorted[1] ?? sorted[0];
  return {
    top,
    second,
    margin: top.score - second.score,
  };
}

function lexicalIntent(message: string): RuntimeSemanticIntent {
  const normalized = message.toLowerCase();
  if (GREETING_RE.test(normalized)) return "greeting";
  if (CAPABILITIES_RE.test(normalized)) return "capabilities";

  const hasEmail = EMAIL_RE.test(normalized);
  const hasCalendar = CALENDAR_RE.test(normalized);
  const hasPolicy = POLICY_RE.test(normalized);
  const mutating = MUTATION_RE.test(normalized);

  if ((hasEmail && hasCalendar) || (hasPolicy && (hasEmail || hasCalendar))) {
    return "cross_surface_plan";
  }
  if (hasEmail && ATTENTION_RE.test(normalized)) return "inbox_attention";
  if (hasEmail && mutating) return "inbox_mutation";
  if (hasCalendar && mutating) return "calendar_mutation";
  if (hasEmail) return "inbox_read";
  if (hasCalendar) return "calendar_read";
  if (hasPolicy) return "policy_controls";
  return "general";
}

function buildLexicalContract(message: string): RuntimeSemanticContract {
  const intent = lexicalIntent(message);
  return buildContractFromIntent({
    message,
    intent,
    confidence: 0.62,
    source: "lexical",
  });
}

async function buildEmbeddingContract(message: string): Promise<RuntimeSemanticContract | null> {
  if (!ENABLED_SEMANTIC_ROUTING || !EmbeddingService.isAvailable()) return null;

  const [messageEmbedding, centroids] = await Promise.all([
    EmbeddingService.generateEmbedding(message),
    getIntentCentroids(),
  ]);

  const scoreEntries: IntentScoreEntry[] = [];
  const intents = Object.keys(centroids) as RuntimeSemanticIntent[];

  for (const intent of intents) {
    const score = EmbeddingService.cosineSimilarity(messageEmbedding, centroids[intent]);
    scoreEntries.push({ intent, score });
  }

  const ranked = rankSemanticIntentScores(scoreEntries);
  if (!ranked || ranked.top.score < MIN_SEMANTIC_SCORE) return null;

  return buildContractFromIntent({
    message,
    intent: ranked.top.intent,
    confidence: ranked.top.score,
    source: "embedding",
    classifier: {
      topIntent: ranked.top.intent,
      topScore: Number(ranked.top.score.toFixed(4)),
      secondIntent: ranked.second.intent,
      secondScore: Number(ranked.second.score.toFixed(4)),
      margin: Number(ranked.margin.toFixed(4)),
    },
  });
}

export async function classifyRuntimeSemanticContract(params: {
  message: string;
  logger?: Logger;
}): Promise<RuntimeSemanticContract> {
  const message = params.message.trim();
  if (!message) {
    return buildContractFromIntent({
      message: "help",
      intent: "general",
      confidence: 0.6,
      source: "lexical",
    });
  }

  try {
    const semanticTimeoutMs = resolveSemanticTimeoutMs(message);
    const contract = await withTimeout(buildEmbeddingContract(message), semanticTimeoutMs);
    if (contract) {
      params.logger?.trace("Runtime semantic contract resolved", {
        source: contract.source,
        intent: contract.intent,
        domain: contract.domain,
        requestedOperation: contract.requestedOperation,
        complexity: contract.complexity,
        routeProfile: contract.routeProfile,
        riskLevel: contract.riskLevel,
        confidence: contract.confidence,
        classifierMargin: contract.classifier?.margin ?? null,
        timeoutMs: semanticTimeoutMs,
      });
      return contract;
    }
  } catch (error) {
    logger.warn("Semantic contract embedding classification unavailable", { error });
  }

  const fallback = buildLexicalContract(message);
  params.logger?.trace("Runtime semantic contract fallback", {
    source: fallback.source,
    intent: fallback.intent,
    domain: fallback.domain,
    requestedOperation: fallback.requestedOperation,
    complexity: fallback.complexity,
    routeProfile: fallback.routeProfile,
    riskLevel: fallback.riskLevel,
    confidence: fallback.confidence,
    classifierMargin: fallback.classifier?.margin ?? null,
  });
  return fallback;
}
