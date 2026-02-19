import { EmbeddingService } from "@/features/memory/embeddings/service";
import {
  capTimeoutToRuntimeBudget,
  getRuntimeRemainingMs,
} from "@/server/features/ai/runtime/deadline-context";
import type {
  RankingDocument,
  UnifiedSearchIntentHints,
  UnifiedSearchRankingFeatures,
} from "@/server/features/search/unified/types";
import { resolveRuntimeUnifiedRankingWeights } from "@/server/features/search/unified/weights";

const MAX_SEMANTIC_DOCS = 80;
const MIN_SEMANTIC_DOCS = 12;
const DEFAULT_SEMANTIC_TIMEOUT_MS = 5_500;
const MAX_DOC_EMBED_CHARS = 1_600;
const SEMANTIC_CIRCUIT_FAILURES_TO_OPEN = 3;
const SEMANTIC_CIRCUIT_OPEN_MS = 90_000;
const MIN_TOKEN_LENGTH = 2;

const semanticCircuitState: {
  consecutiveFailures: number;
  openUntilMs: number;
  lastError?: string;
} = {
  consecutiveFailures: 0,
  openUntilMs: 0,
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9@._-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

function normalizeText(text: string | undefined): string {
  return (text ?? "").trim().toLowerCase();
}

function normalizeForEmbedding(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= MAX_DOC_EMBED_CHARS
    ? compact
    : `${compact.slice(0, MAX_DOC_EMBED_CHARS)}…`;
}

function lexicalScore(query: string, docText: string): number {
  const q = normalizeText(query);
  if (!q) return 0;

  const haystack = normalizeText(docText);
  if (!haystack) return 0;

  let score = 0;

  if (haystack.includes(q)) {
    score += 0.55;
  }

  const qTokens = tokenize(q);
  const docTokens = tokenize(haystack);
  if (qTokens.length === 0 || docTokens.length === 0) {
    return Math.max(0, Math.min(1, score));
  }

  const docTokenSet = new Set(docTokens);
  const matched = qTokens.filter((token) => docTokenSet.has(token)).length;
  const tokenCoverage = matched / qTokens.length;

  score += tokenCoverage * 0.35;

  // Soft containment for fuzzy natural phrasing.
  const partials = qTokens.filter((token) =>
    docTokens.some((docToken) =>
      docToken.includes(token) || token.includes(docToken),
    ),
  ).length;
  const partialCoverage = partials / qTokens.length;
  score += partialCoverage * 0.1;

  return Math.max(0, Math.min(1, score));
}

function recencyBoost(timestamp: string | undefined): number {
  if (!timestamp) return 0;
  const ts = Date.parse(timestamp);
  if (!Number.isFinite(ts)) return 0;

  const ageMs = Date.now() - ts;
  if (ageMs <= 0) return 1;
  const days = ageMs / (24 * 60 * 60 * 1000);

  if (days <= 1) return 1;
  if (days <= 7) return 0.7;
  if (days <= 30) return 0.45;
  if (days <= 90) return 0.2;
  return 0;
}

function resolveSemanticTimeoutMs(): number {
  const raw = Number.parseInt(
    process.env.UNIFIED_SEARCH_SEMANTIC_TIMEOUT_MS ?? String(DEFAULT_SEMANTIC_TIMEOUT_MS),
    10,
  );
  if (!Number.isFinite(raw)) return DEFAULT_SEMANTIC_TIMEOUT_MS;
  return Math.max(1_500, Math.min(raw, 20_000));
}

function resolveSemanticDocLimit(totalDocs: number): number {
  const envMax = (() => {
    const raw = Number.parseInt(
      process.env.UNIFIED_SEARCH_SEMANTIC_MAX_DOCS ?? String(MAX_SEMANTIC_DOCS),
      10,
    );
    if (!Number.isFinite(raw)) return MAX_SEMANTIC_DOCS;
    return Math.max(MIN_SEMANTIC_DOCS, Math.min(raw, MAX_SEMANTIC_DOCS));
  })();

  const remainingMs = getRuntimeRemainingMs();
  if (typeof remainingMs !== "number") {
    return Math.min(totalDocs, envMax);
  }
  if (remainingMs <= 3_000) return Math.min(totalDocs, MIN_SEMANTIC_DOCS);
  if (remainingMs <= 6_000) return Math.min(totalDocs, Math.min(envMax, 24));
  if (remainingMs <= 10_000) return Math.min(totalDocs, Math.min(envMax, 48));
  return Math.min(totalDocs, envMax);
}

function isSemanticCircuitOpen(): boolean {
  return semanticCircuitState.openUntilMs > Date.now();
}

function markSemanticFailure(message: string): void {
  semanticCircuitState.consecutiveFailures += 1;
  semanticCircuitState.lastError = message;
  if (semanticCircuitState.consecutiveFailures >= SEMANTIC_CIRCUIT_FAILURES_TO_OPEN) {
    semanticCircuitState.openUntilMs = Date.now() + SEMANTIC_CIRCUIT_OPEN_MS;
  }
}

function markSemanticSuccess(): void {
  semanticCircuitState.consecutiveFailures = 0;
  semanticCircuitState.openUntilMs = 0;
  semanticCircuitState.lastError = undefined;
}

async function withLocalTimeout<T>(params: {
  timeoutMs: number;
  run: () => Promise<T>;
}): Promise<T | null> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      params.run(),
      new Promise<null>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(null), params.timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function semanticScores(params: {
  query: string;
  docs: RankingDocument[];
}): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const query = normalizeText(params.query);
  if (!query) return scores;
  if (!EmbeddingService.isAvailable()) return scores;
  if (isSemanticCircuitOpen()) return scores;

  const candidateDocs = params.docs.slice(0, resolveSemanticDocLimit(params.docs.length));
  if (candidateDocs.length === 0) return scores;

  const payloads = [
    normalizeForEmbedding(query),
    ...candidateDocs.map((doc) => normalizeForEmbedding(`${doc.title}\n${doc.snippet}`)),
  ];
  const timeoutMs = capTimeoutToRuntimeBudget({
    requestedMs: resolveSemanticTimeoutMs(),
    minimumMs: 1_500,
    reserveMs: 2_500,
  });
  try {
    const embeddings = await withLocalTimeout({
      timeoutMs,
      run: () => EmbeddingService.generateEmbeddings(payloads),
    });
    if (!embeddings || embeddings.length !== payloads.length) {
      markSemanticFailure("semantic_embedding_timeout_or_mismatch");
      return scores;
    }

    const queryEmbedding = embeddings[0];
    for (let i = 0; i < candidateDocs.length; i += 1) {
      const doc = candidateDocs[i]!;
      const docEmbedding = embeddings[i + 1];
      const similarity = EmbeddingService.cosineSimilarity(queryEmbedding, docEmbedding);
      // Map [-1,1] to [0,1]
      const normalized = Math.max(0, Math.min(1, (similarity + 1) / 2));
      scores.set(doc.id, normalized);
    }
    markSemanticSuccess();
    return scores;
  } catch (error) {
    markSemanticFailure(error instanceof Error ? error.message : "semantic_embedding_failed");
    return scores;
  }
}

export interface RankedDocument {
  doc: RankingDocument;
  score: number;
  lexicalScore: number;
  semanticScore?: number;
  features: UnifiedSearchRankingFeatures;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function readNumericMetadata(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!metadata) return undefined;
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function intentSurfaceScore(doc: RankingDocument, hints: UnifiedSearchIntentHints | undefined): number {
  if (!hints || hints.requestedSurfaces.size === 0) return 0.6;
  if (hints.requestedSurfaces.has(doc.surface)) return 1;
  return 0.25;
}

function mailboxIntentScore(
  doc: RankingDocument,
  hints: UnifiedSearchIntentHints | undefined,
): number {
  if (!hints?.mailbox || doc.surface !== "email") return 0.6;
  const mailbox = String(doc.metadata?.mailbox ?? "").toLowerCase();
  const isSent = doc.metadata?.isSent === true;
  const isInbox = doc.metadata?.isInbox === true;
  const isDraft = doc.metadata?.isDraft === true;
  if (hints.mailbox === "sent") return mailbox === "sent" || isSent ? 1 : 0.15;
  if (hints.mailbox === "inbox") return mailbox === "inbox" || isInbox ? 1 : 0.15;
  if (hints.mailbox === "draft") return mailbox === "draft" || isDraft ? 1 : 0.15;
  return 0.7;
}

export async function rankDocuments(params: {
  query: string;
  docs: RankingDocument[];
  intentHints?: UnifiedSearchIntentHints;
}): Promise<RankedDocument[]> {
  const lexicalRanked = params.docs.map((doc) => {
    const combinedText = `${doc.title}\n${doc.snippet}`;
    const lScore = lexicalScore(params.query, combinedText);
    const freshnessMeta =
      readNumericMetadata(doc.metadata, "freshnessScore") ??
      readNumericMetadata(doc.metadata, "freshness");
    const authorityMeta =
      readNumericMetadata(doc.metadata, "authorityScore") ??
      readNumericMetadata(doc.metadata, "authority");
    const behaviorMeta =
      readNumericMetadata(doc.metadata, "behaviorScore") ??
      readNumericMetadata(doc.metadata, "behavior");
    const graphMeta =
      readNumericMetadata(doc.metadata, "graphScore") ??
      readNumericMetadata(doc.metadata, "graphProximity");

    return {
      doc,
      lexicalScore: lScore,
      recency: recencyBoost(doc.timestamp),
      freshnessMeta,
      authorityMeta,
      behaviorMeta,
      graphMeta,
    };
  });

  const lexicalSorted = [...lexicalRanked].sort((a, b) => b.lexicalScore - a.lexicalScore);
  const semanticById = await semanticScores({
    query: params.query,
    docs: lexicalSorted.map((entry) => entry.doc),
  });

  const hasSemantic = semanticById.size > 0;
  const weights = resolveRuntimeUnifiedRankingWeights();

  const ranked = lexicalSorted.map((entry) => {
    const semantic = semanticById.get(entry.doc.id);
    const freshness = clampUnit(
      entry.recency * 0.65 + (entry.freshnessMeta ?? entry.recency) * 0.35,
    );
    const authority = clampUnit(entry.authorityMeta ?? 0.4);
    const intentSurface = clampUnit(
      intentSurfaceScore(entry.doc, params.intentHints) * 0.7 +
        mailboxIntentScore(entry.doc, params.intentHints) * 0.3,
    );
    const behavior = clampUnit(entry.behaviorMeta ?? 0);
    const graph = clampUnit(entry.graphMeta ?? 0);

    const lexicalWeight = hasSemantic
      ? weights.lexicalWithSemantic
      : weights.lexicalWithoutSemantic;
    const semanticWeight = hasSemantic ? weights.semantic : 0;
    const score =
      entry.lexicalScore * lexicalWeight +
      (semantic ?? 0) * semanticWeight +
      freshness * weights.freshness +
      authority * weights.authority +
      intentSurface * weights.intentSurface +
      behavior * weights.behavior +
      graph * weights.graphProximity;

    const features: UnifiedSearchRankingFeatures = {
      lexical: entry.lexicalScore,
      semantic,
      freshness,
      authority,
      intentSurface,
      behavior,
      graphProximity: graph,
      final: clampUnit(score),
    };

    return {
      doc: entry.doc,
      score: features.final,
      lexicalScore: entry.lexicalScore,
      semanticScore: semantic,
      features,
    } satisfies RankedDocument;
  });

  return ranked.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) > 1e-6) return scoreDiff;

    const aTs = a.doc.timestamp ? Date.parse(a.doc.timestamp) : 0;
    const bTs = b.doc.timestamp ? Date.parse(b.doc.timestamp) : 0;
    if (Number.isFinite(aTs) && Number.isFinite(bTs) && bTs !== aTs) {
      return bTs - aTs;
    }

    return a.doc.id.localeCompare(b.doc.id);
  });
}

export const __testing = {
  resetSemanticCircuit: () => {
    semanticCircuitState.consecutiveFailures = 0;
    semanticCircuitState.openUntilMs = 0;
    semanticCircuitState.lastError = undefined;
  },
};
