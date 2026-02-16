/**
 * Semantic search utilities using pgvector.
 * Provides robust hybrid search (semantic + keyword) with graceful fallback.
 */
import { Prisma } from "@/generated/prisma/client";
import prisma from "@/server/db/client";
import { EmbeddingService } from "./service";
import { createScopedLogger } from "@/server/lib/logger";
import type { MemoryFact, Knowledge, ConversationMessage } from "@/generated/prisma/client";
import { logMemoryAccessAudit } from "@/server/features/memory/structured/service";

const logger = createScopedLogger("SemanticSearch");

type VectorTarget = "MemoryFact" | "Knowledge" | "ConversationMessage";

type HybridScoredCandidate<T extends { id: string }> = {
  item: T;
  semanticScore?: number;
  keywordScore?: number;
};

type ReadinessCacheEntry = {
  checkedAt: number;
  ready: boolean;
  reason?: string;
};

const VECTOR_READINESS_TTL_MS = 5 * 60 * 1000;
const readinessCache = new Map<VectorTarget, ReadinessCacheEntry>();

const HYBRID_VECTOR_WEIGHT = resolveEnvNumber(
  "MEMORY_HYBRID_VECTOR_WEIGHT",
  0.72,
  0,
  1,
);
const HYBRID_TEXT_WEIGHT = resolveEnvNumber(
  "MEMORY_HYBRID_TEXT_WEIGHT",
  0.28,
  0,
  1,
);
const HYBRID_CANDIDATE_MULTIPLIER = Math.max(
  1,
  Math.round(resolveEnvNumber("MEMORY_HYBRID_CANDIDATE_MULTIPLIER", 3, 1, 8)),
);
const CONVERSATION_SIMILARITY_THRESHOLD = resolveEnvNumber(
  "MEMORY_CONVERSATION_SIMILARITY_THRESHOLD",
  0.3,
  0,
  1,
);

function resolveEnvNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/** Format embedding number[] as a pgvector literal for raw SQL (e.g. [0.1, -0.2, ...]). */
function toPgVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function splitKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(1, score));
}

async function hasVectorExtension(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS "exists"
  `;
  return Boolean(rows[0]?.exists);
}

async function embeddingColumnReachable(target: VectorTarget): Promise<void> {
  await prisma.$queryRawUnsafe(`SELECT embedding FROM "${target}" WHERE embedding IS NOT NULL LIMIT 1`);
}

async function canUseSemanticFor(target: VectorTarget): Promise<boolean> {
  if (!EmbeddingService.isAvailable()) return false;

  const cached = readinessCache.get(target);
  if (cached && Date.now() - cached.checkedAt < VECTOR_READINESS_TTL_MS) {
    return cached.ready;
  }

  try {
    const hasVector = await hasVectorExtension();
    if (!hasVector) {
      readinessCache.set(target, {
        checkedAt: Date.now(),
        ready: false,
        reason: "vector_extension_missing",
      });
      logger.warn("Semantic search disabled: pgvector extension unavailable", { target });
      return false;
    }

    await embeddingColumnReachable(target);
    readinessCache.set(target, {
      checkedAt: Date.now(),
      ready: true,
    });
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    readinessCache.set(target, {
      checkedAt: Date.now(),
      ready: false,
      reason,
    });
    logger.warn("Semantic search disabled: vector infrastructure not ready", {
      target,
      reason,
    });
    return false;
  }
}

function candidateLimit(limit: number): number {
  return Math.min(Math.max(limit * HYBRID_CANDIDATE_MULTIPLIER, limit), 80);
}

function fuseHybridResults<T extends { id: string }>(params: {
  semantic: Array<{ item: T; score: number }>;
  keyword: Array<{ item: T; score: number }>;
  limit: number;
}): SearchResult<T>[] {
  const map = new Map<string, HybridScoredCandidate<T>>();

  for (const entry of params.semantic) {
    map.set(entry.item.id, {
      item: entry.item,
      semanticScore: clampScore(entry.score),
    });
  }

  for (const entry of params.keyword) {
    const existing = map.get(entry.item.id);
    if (existing) {
      existing.keywordScore = clampScore(entry.score);
    } else {
      map.set(entry.item.id, {
        item: entry.item,
        keywordScore: clampScore(entry.score),
      });
    }
  }

  const out: SearchResult<T>[] = [];
  for (const candidate of map.values()) {
    const semanticScore = candidate.semanticScore;
    const keywordScore = candidate.keywordScore;

    if (typeof semanticScore === "number" && typeof keywordScore === "number") {
      out.push({
        item: candidate.item,
        score: clampScore(semanticScore * HYBRID_VECTOR_WEIGHT + keywordScore * HYBRID_TEXT_WEIGHT),
        matchType: "both",
      });
      continue;
    }

    if (typeof semanticScore === "number") {
      out.push({
        item: candidate.item,
        score: clampScore(semanticScore * HYBRID_VECTOR_WEIGHT),
        matchType: "semantic",
      });
      continue;
    }

    out.push({
      item: candidate.item,
      score: clampScore((keywordScore ?? 0.5) * HYBRID_TEXT_WEIGHT),
      matchType: "keyword",
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, params.limit);
}

function memoryKeywordScore(params: {
  fact: Pick<MemoryFact, "key" | "value">;
  keywords: string[];
  normalizedQuery: string;
}): number {
  const haystack = `${params.fact.key} ${params.fact.value}`.toLowerCase();
  if (params.normalizedQuery.length > 0 && haystack.includes(params.normalizedQuery)) {
    return 0.85;
  }

  if (params.keywords.length === 0) return 0.5;
  const matches = params.keywords.reduce(
    (count, keyword) => count + (haystack.includes(keyword) ? 1 : 0),
    0,
  );
  if (matches === 0) return 0.35;
  return 0.4 + (matches / params.keywords.length) * 0.5;
}

function knowledgeKeywordScore(params: {
  item: Pick<Knowledge, "title" | "content">;
  keywords: string[];
  normalizedQuery: string;
}): number {
  const haystack = `${params.item.title} ${params.item.content}`.toLowerCase();
  if (params.normalizedQuery.length > 0 && haystack.includes(params.normalizedQuery)) {
    return 0.85;
  }

  if (params.keywords.length === 0) return 0.5;
  const matches = params.keywords.reduce(
    (count, keyword) => count + (haystack.includes(keyword) ? 1 : 0),
    0,
  );
  if (matches === 0) return 0.35;
  return 0.4 + (matches / params.keywords.length) * 0.5;
}

export interface SearchResult<T> {
  item: T;
  score: number;
  matchType: "semantic" | "keyword" | "both";
}

/**
 * Search MemoryFacts using a resilient hybrid retrieval path.
 */
export async function searchMemoryFacts({
  userId,
  query,
  limit = 10,
}: {
  userId: string;
  query: string;
  limit?: number;
}): Promise<SearchResult<MemoryFact>[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const semanticReady = await canUseSemanticFor("MemoryFact");
  if (!semanticReady) {
    const results = await keywordSearchMemoryFacts({ userId, query: trimmedQuery, limit });
    logMemoryAccessAudit({
      userId,
      accessType: "memory_fact_search",
      query: trimmedQuery,
      resultCount: results.length,
      metadata: { semanticReady: false, strategy: "keyword" },
    }).catch(() => {});
    return results;
  }

  try {
    const results = await hybridSearchMemoryFacts({ userId, query: trimmedQuery, limit });
    logMemoryAccessAudit({
      userId,
      accessType: "memory_fact_search",
      query: trimmedQuery,
      resultCount: results.length,
      metadata: { semanticReady: true, strategy: "hybrid" },
    }).catch(() => {});
    return results;
  } catch (error) {
    logger.warn("Hybrid memory fact search failed; falling back to keyword search", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    const fallbackResults = await keywordSearchMemoryFacts({ userId, query: trimmedQuery, limit });
    logMemoryAccessAudit({
      userId,
      accessType: "memory_fact_search",
      query: trimmedQuery,
      resultCount: fallbackResults.length,
      metadata: { semanticReady: true, strategy: "keyword_fallback" },
    }).catch(() => {});
    return fallbackResults;
  }
}

async function hybridSearchMemoryFacts({
  userId,
  query,
  limit,
}: {
  userId: string;
  query: string;
  limit: number;
}): Promise<SearchResult<MemoryFact>[]> {
  const queryEmbedding = await EmbeddingService.generateEmbedding(query);
  const vectorLiteral = toPgVectorLiteral(queryEmbedding);
  const normalizedQuery = query.toLowerCase().trim();
  const keywords = splitKeywords(query);
  const take = candidateLimit(limit);

  const [semanticRows, keywordRows] = await Promise.all([
    prisma.$queryRaw<Array<MemoryFact & { distance: number }>>`
      SELECT *, (embedding <=> ${Prisma.raw(`'${vectorLiteral}'::vector`)}) AS distance
      FROM "MemoryFact"
      WHERE "userId" = ${userId}
        AND embedding IS NOT NULL
        AND "isActive" = true
      ORDER BY embedding <=> ${Prisma.raw(`'${vectorLiteral}'::vector`)}
      LIMIT ${take}
    `,
    prisma.memoryFact.findMany({
      where: {
        userId,
        isActive: true,
        OR:
          keywords.length > 0
            ? keywords.flatMap((keyword) => [
                { key: { contains: keyword, mode: "insensitive" } },
                { value: { contains: keyword, mode: "insensitive" } },
              ])
            : [
                { key: { contains: query, mode: "insensitive" } },
                { value: { contains: query, mode: "insensitive" } },
              ],
      },
      take,
    }),
  ]);

  const semantic = semanticRows.map((row) => {
    const { distance, ...item } = row;
    return {
      item: item as MemoryFact,
      score: clampScore(1 - distance / 2),
    };
  });

  const keyword = keywordRows.map((row) => ({
    item: row,
    score: memoryKeywordScore({
      fact: row,
      keywords,
      normalizedQuery,
    }),
  }));

  return fuseHybridResults({ semantic, keyword, limit });
}

async function keywordSearchMemoryFacts({
  userId,
  query,
  limit,
}: {
  userId: string;
  query: string;
  limit: number;
}): Promise<SearchResult<MemoryFact>[]> {
  const normalizedQuery = query.toLowerCase().trim();
  const keywords = splitKeywords(query);

  const rows = await prisma.memoryFact.findMany({
    where: {
      userId,
      isActive: true,
      OR:
        keywords.length > 0
          ? keywords.flatMap((keyword) => [
              { key: { contains: keyword, mode: "insensitive" } },
              { value: { contains: keyword, mode: "insensitive" } },
            ])
          : [
              { key: { contains: query, mode: "insensitive" } },
              { value: { contains: query, mode: "insensitive" } },
            ],
    },
    take: Math.max(1, limit),
  });

  return rows
    .map((row) => ({
      item: row,
      score: clampScore(
        memoryKeywordScore({
          fact: row,
          keywords,
          normalizedQuery,
        }) * HYBRID_TEXT_WEIGHT,
      ),
      matchType: "keyword" as const,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Search Knowledge using a resilient hybrid retrieval path.
 */
export async function searchKnowledge({
  userId,
  query,
  limit = 5,
}: {
  userId: string;
  query: string;
  limit?: number;
}): Promise<SearchResult<Knowledge>[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const semanticReady = await canUseSemanticFor("Knowledge");
  if (!semanticReady) {
    return keywordSearchKnowledge({ userId, query: trimmedQuery, limit });
  }

  try {
    return await hybridSearchKnowledge({ userId, query: trimmedQuery, limit });
  } catch (error) {
    logger.warn("Hybrid knowledge search failed; falling back to keyword search", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return keywordSearchKnowledge({ userId, query: trimmedQuery, limit });
  }
}

async function hybridSearchKnowledge({
  userId,
  query,
  limit,
}: {
  userId: string;
  query: string;
  limit: number;
}): Promise<SearchResult<Knowledge>[]> {
  const queryEmbedding = await EmbeddingService.generateEmbedding(query);
  const vectorLiteral = toPgVectorLiteral(queryEmbedding);
  const normalizedQuery = query.toLowerCase().trim();
  const keywords = splitKeywords(query);
  const take = candidateLimit(limit);

  const [semanticRows, keywordRows] = await Promise.all([
    prisma.$queryRaw<Array<Knowledge & { distance: number }>>`
      SELECT *, (embedding <=> ${Prisma.raw(`'${vectorLiteral}'::vector`)}) AS distance
      FROM "Knowledge"
      WHERE "userId" = ${userId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${Prisma.raw(`'${vectorLiteral}'::vector`)}
      LIMIT ${take}
    `,
    prisma.knowledge.findMany({
      where: {
        userId,
        OR:
          keywords.length > 0
            ? keywords.flatMap((keyword) => [
                { title: { contains: keyword, mode: "insensitive" } },
                { content: { contains: keyword, mode: "insensitive" } },
              ])
            : [
                { title: { contains: query, mode: "insensitive" } },
                { content: { contains: query, mode: "insensitive" } },
              ],
      },
      take,
    }),
  ]);

  const semantic = semanticRows.map((row) => {
    const { distance, ...item } = row;
    return {
      item: item as Knowledge,
      score: clampScore(1 - distance / 2),
    };
  });

  const keyword = keywordRows.map((row) => ({
    item: row,
    score: knowledgeKeywordScore({
      item: row,
      keywords,
      normalizedQuery,
    }),
  }));

  return fuseHybridResults({ semantic, keyword, limit });
}

async function keywordSearchKnowledge({
  userId,
  query,
  limit,
}: {
  userId: string;
  query: string;
  limit: number;
}): Promise<SearchResult<Knowledge>[]> {
  const normalizedQuery = query.toLowerCase().trim();
  const keywords = splitKeywords(query);

  const rows = await prisma.knowledge.findMany({
    where: {
      userId,
      OR:
        keywords.length > 0
          ? keywords.flatMap((keyword) => [
              { title: { contains: keyword, mode: "insensitive" } },
              { content: { contains: keyword, mode: "insensitive" } },
            ])
          : [
              { title: { contains: query, mode: "insensitive" } },
              { content: { contains: query, mode: "insensitive" } },
            ],
    },
    take: Math.max(1, limit),
  });

  return rows
    .map((row) => ({
      item: row,
      score: clampScore(
        knowledgeKeywordScore({
          item: row,
          keywords,
          normalizedQuery,
        }) * HYBRID_TEXT_WEIGHT,
      ),
      matchType: "keyword" as const,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ============================================================================
// Conversation history relevance search
// ============================================================================

/**
 * Search conversation history by semantic relevance to the current message.
 * Fails soft when vector infra is unavailable.
 */
export async function searchConversationHistory({
  userId,
  query,
  limit,
}: {
  userId: string;
  query: string;
  limit: number;
}): Promise<SearchResult<ConversationMessage>[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const semanticReady = await canUseSemanticFor("ConversationMessage");
  if (!semanticReady) return [];

  try {
    const queryEmbedding = await EmbeddingService.generateEmbedding(trimmedQuery);
    const vectorLiteral = toPgVectorLiteral(queryEmbedding);

    const rows = await prisma.$queryRaw<
      Array<ConversationMessage & { similarity: number }>
    >`
      SELECT cm.id, cm."createdAt", cm."userId", cm."conversationId", cm."dedupeKey",
             cm.role, cm.content, cm."toolCalls", cm.provider, cm."providerMessageId",
             cm."channelId", cm."threadId", cm."emailAccountId",
             1 - (cm.embedding <=> ${Prisma.raw(`'${vectorLiteral}'::vector`)}) AS similarity
      FROM "ConversationMessage" cm
      WHERE cm."userId" = ${userId}
        AND cm.embedding IS NOT NULL
        AND (1 - (cm.embedding <=> ${Prisma.raw(`'${vectorLiteral}'::vector`)})) > ${CONVERSATION_SIMILARITY_THRESHOLD}
      ORDER BY cm.embedding <=> ${Prisma.raw(`'${vectorLiteral}'::vector`)}
      LIMIT ${Math.max(1, limit)}
    `;

    const results = rows.map((row) => {
      const { similarity, ...item } = row;
      return {
        item: item as ConversationMessage,
        score: clampScore(similarity),
        matchType: "semantic" as const,
      };
    });
    logMemoryAccessAudit({
      userId,
      accessType: "conversation_semantic_search",
      query: trimmedQuery,
      resultCount: results.length,
      metadata: { threshold: CONVERSATION_SIMILARITY_THRESHOLD },
    }).catch(() => {});
    return results;
  } catch (error) {
    logger.warn("Conversation semantic search failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// ============================================================================
// Semantic Deduplication
// ============================================================================

/**
 * Find semantically similar existing memory facts.
 */
export async function findSemanticDuplicates({
  userId,
  newFactText,
  threshold = 0.92,
}: {
  userId: string;
  newFactText: string;
  threshold?: number;
}): Promise<Array<{ fact: MemoryFact; similarity: number }>> {
  if (!EmbeddingService.isAvailable()) {
    logger.trace("Embedding service unavailable, skipping semantic dedupe");
    return [];
  }

  try {
    const results = await searchMemoryFacts({
      userId,
      query: newFactText,
      limit: 5,
    });

    const duplicates = results
      .filter((result) => result.score >= threshold)
      .map((result) => ({
        fact: result.item,
        similarity: result.score,
      }));

    if (duplicates.length > 0) {
      logger.trace("Found potential duplicates", {
        newFactText: newFactText.slice(0, 50),
        duplicateCount: duplicates.length,
        topSimilarity: duplicates[0]?.similarity,
      });
    }

    return duplicates;
  } catch (error) {
    logger.warn("Semantic dedupe failed", { error, userId });
    return [];
  }
}

/**
 * Check if a new fact would be a duplicate of an existing one.
 */
export async function checkForDuplicate({
  userId,
  key,
  value,
}: {
  userId: string;
  key: string;
  value: string;
}): Promise<MemoryFact | null> {
  const text = `${key}: ${value}`;
  const duplicates = await findSemanticDuplicates({
    userId,
    newFactText: text,
    threshold: 0.92,
  });

  if (duplicates.length > 0) {
    return duplicates[0].fact;
  }

  return null;
}
