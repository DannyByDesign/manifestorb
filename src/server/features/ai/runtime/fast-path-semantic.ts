import { EmbeddingService } from "@/server/features/memory/embeddings/service";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("RuntimeFastPathSemantic");
const SEMANTIC_TIMEOUT_MS = 1200;

const ENABLED_SEMANTIC_ROUTING =
  process.env.VITEST !== "true" && process.env.NODE_ENV !== "test";

type SemanticIntent =
  | "greeting"
  | "capabilities"
  | "inbox_first_or_latest"
  | "inbox_attention"
  | "calendar_read";

const INTENT_EXAMPLES: Record<SemanticIntent, string[]> = {
  greeting: [
    "hello",
    "hey there",
    "good morning",
    "hi assistant",
  ],
  capabilities: [
    "what can you do for me",
    "what are your capabilities",
    "how can you help",
    "what do you handle",
  ],
  inbox_first_or_latest: [
    "show me the newest email",
    "what is the latest message in my inbox",
    "get my first inbox email right now",
    "find the most recent email",
  ],
  inbox_attention: [
    "what emails need my attention today",
    "show unread emails",
    "which emails do I need to reply to",
    "find priority emails in my inbox",
  ],
  calendar_read: [
    "what meetings do I have today",
    "show my schedule for monday",
    "what events are on my calendar tomorrow",
    "list my calendar events",
  ],
};

const MIN_SCORE_STRICT = 0.82;
const MIN_SCORE_RECOVERY = 0.78;

let centroidPromise: Promise<Record<SemanticIntent, number[]>> | null = null;

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dimension = vectors[0].length;
  const out = new Array<number>(dimension).fill(0);

  for (const vector of vectors) {
    for (let i = 0; i < dimension; i += 1) {
      out[i] += vector[i];
    }
  }

  for (let i = 0; i < dimension; i += 1) {
    out[i] /= vectors.length;
  }
  return out;
}

async function buildIntentCentroids(): Promise<Record<SemanticIntent, number[]>> {
  const intents = Object.keys(INTENT_EXAMPLES) as SemanticIntent[];
  const allExamples: string[] = [];
  const intentByExampleIndex: SemanticIntent[] = [];

  for (const intent of intents) {
    for (const sample of INTENT_EXAMPLES[intent]) {
      allExamples.push(sample);
      intentByExampleIndex.push(intent);
    }
  }

  const embeddings = await EmbeddingService.generateEmbeddings(allExamples, undefined, false);
  const grouped: Record<SemanticIntent, number[][]> = {
    greeting: [],
    capabilities: [],
    inbox_first_or_latest: [],
    inbox_attention: [],
    calendar_read: [],
  };

  for (let i = 0; i < embeddings.length; i += 1) {
    const intent = intentByExampleIndex[i];
    grouped[intent].push(embeddings[i]);
  }

  return {
    greeting: averageVectors(grouped.greeting),
    capabilities: averageVectors(grouped.capabilities),
    inbox_first_or_latest: averageVectors(grouped.inbox_first_or_latest),
    inbox_attention: averageVectors(grouped.inbox_attention),
    calendar_read: averageVectors(grouped.calendar_read),
  };
}

async function getIntentCentroids(): Promise<Record<SemanticIntent, number[]>> {
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

export async function classifySemanticFastPathIntent(params: {
  message: string;
  mode: "strict" | "recovery";
}): Promise<{ intent: SemanticIntent; score: number } | null> {
  const { message, mode } = params;
  if (!ENABLED_SEMANTIC_ROUTING || !EmbeddingService.isAvailable()) return null;

  const run = async (): Promise<{ intent: SemanticIntent; score: number } | null> => {
    const [messageEmbedding, centroids] = await Promise.all([
      EmbeddingService.generateEmbedding(message),
      getIntentCentroids(),
    ]);

    let bestIntent: SemanticIntent | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    const intents = Object.keys(centroids) as SemanticIntent[];

    for (const intent of intents) {
      const centroid = centroids[intent];
      const score = EmbeddingService.cosineSimilarity(messageEmbedding, centroid);
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    if (!bestIntent) return null;

    const minScore = mode === "strict" ? MIN_SCORE_STRICT : MIN_SCORE_RECOVERY;
    if (bestScore < minScore) return null;

    return { intent: bestIntent, score: bestScore };
  };

  try {
    const result = await withTimeout(run(), SEMANTIC_TIMEOUT_MS);
    if (result) {
      logger.trace("Semantic fast-path intent matched", {
        intent: result.intent,
        score: Number(result.score.toFixed(4)),
        mode,
      });
    }
    return result;
  } catch (error) {
    logger.warn("Semantic fast-path classifier unavailable", {
      error,
      mode,
    });
    return null;
  }
}
