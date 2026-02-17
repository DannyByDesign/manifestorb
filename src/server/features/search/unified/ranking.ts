import { EmbeddingService } from "@/features/memory/embeddings/service";
import type { RankingDocument } from "@/server/features/search/unified/types";

const MAX_SEMANTIC_DOCS = 80;
const MIN_TOKEN_LENGTH = 2;

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

async function semanticScores(params: {
  query: string;
  docs: RankingDocument[];
}): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const query = normalizeText(params.query);
  if (!query) return scores;
  if (!EmbeddingService.isAvailable()) return scores;

  const candidateDocs = params.docs.slice(0, MAX_SEMANTIC_DOCS);
  if (candidateDocs.length === 0) return scores;

  const payloads = [query, ...candidateDocs.map((doc) => `${doc.title}\n${doc.snippet}`)];
  const embeddings = await EmbeddingService.generateEmbeddings(payloads);
  if (embeddings.length !== payloads.length) return scores;

  const queryEmbedding = embeddings[0];
  for (let i = 0; i < candidateDocs.length; i += 1) {
    const doc = candidateDocs[i]!;
    const docEmbedding = embeddings[i + 1];
    const similarity = EmbeddingService.cosineSimilarity(queryEmbedding, docEmbedding);
    // Map [-1,1] to [0,1]
    const normalized = Math.max(0, Math.min(1, (similarity + 1) / 2));
    scores.set(doc.id, normalized);
  }

  return scores;
}

export interface RankedDocument {
  doc: RankingDocument;
  score: number;
  lexicalScore: number;
  semanticScore?: number;
}

export async function rankDocuments(params: {
  query: string;
  docs: RankingDocument[];
}): Promise<RankedDocument[]> {
  const lexicalRanked = params.docs.map((doc) => {
    const combinedText = `${doc.title}\n${doc.snippet}`;
    const lScore = lexicalScore(params.query, combinedText);
    return {
      doc,
      lexicalScore: lScore,
      recency: recencyBoost(doc.timestamp),
    };
  });

  const lexicalSorted = [...lexicalRanked].sort((a, b) => b.lexicalScore - a.lexicalScore);
  const semanticById = await semanticScores({
    query: params.query,
    docs: lexicalSorted.map((entry) => entry.doc),
  });

  const hasSemantic = semanticById.size > 0;

  const ranked = lexicalSorted.map((entry) => {
    const semantic = semanticById.get(entry.doc.id);
    const score = hasSemantic
      ? entry.lexicalScore * 0.62 + (semantic ?? 0) * 0.33 + entry.recency * 0.05
      : entry.lexicalScore * 0.9 + entry.recency * 0.1;

    return {
      doc: entry.doc,
      score: Math.max(0, Math.min(1, score)),
      lexicalScore: entry.lexicalScore,
      semanticScore: semantic,
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
