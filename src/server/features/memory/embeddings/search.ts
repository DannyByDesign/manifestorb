/**
 * Semantic search utilities using pgvector
 * Provides hybrid search (semantic + keyword) for memories and knowledge
 * 
 * Part of the context and memory management system.
 */
import { Prisma } from "@/generated/prisma/client";
import prisma from "@/server/db/client";
import { EmbeddingService } from "./service";
import { createScopedLogger } from "@/server/lib/logger";
import type { MemoryFact, Knowledge } from "@/generated/prisma/client";

const logger = createScopedLogger("SemanticSearch");

/** Format embedding number[] as a pgvector literal for raw SQL (e.g. [0.1, -0.2, ...]). */
function toPgVectorLiteral(embedding: number[]): string {
  return "[" + embedding.join(",") + "]";
}

export interface SearchResult<T> {
  item: T;
  score: number;
  matchType: "semantic" | "keyword" | "both";
}

/**
 * Search MemoryFacts using hybrid (semantic + keyword) approach
 * Falls back to keyword-only search if embeddings are unavailable
 */
export async function searchMemoryFacts({
  userId,
  query,
  limit = 10
}: {
  userId: string;
  query: string;
  limit?: number;
}): Promise<SearchResult<MemoryFact>[]> {
  try {
    // Try semantic search if embeddings are available
    if (EmbeddingService.isAvailable()) {
      return await hybridSearchMemoryFacts({ userId, query, limit });
    }

    // Fallback to keyword-only search
    return await keywordSearchMemoryFacts({ userId, query, limit });
  } catch (error) {
    logger.error("Memory search failed", { error, userId });
    
    // Final fallback to keyword search
    return await keywordSearchMemoryFacts({ userId, query, limit });
  }
}

/**
 * Hybrid search combining semantic and keyword matching
 */
async function hybridSearchMemoryFacts({
  userId,
  query,
  limit
}: {
  userId: string;
  query: string;
  limit: number;
}): Promise<SearchResult<MemoryFact>[]> {
  // Generate query embedding
  const queryEmbedding = await EmbeddingService.generateEmbedding(query);
  const vectorLiteral = toPgVectorLiteral(queryEmbedding);

  // Semantic search using pgvector
  // Using cosine distance (<=>), lower is better
  // Only search active facts
  const semanticResults = await prisma.$queryRaw<(MemoryFact & { distance: number })[]>`
    SELECT *, (embedding <=> ${Prisma.raw("'" + vectorLiteral + "'::vector")}) AS distance
    FROM "MemoryFact"
    WHERE "userId" = ${userId}
      AND embedding IS NOT NULL
      AND "isActive" = true
    ORDER BY embedding <=> ${Prisma.raw("'" + vectorLiteral + "'::vector")}
    LIMIT ${limit}
  `;

  // Keyword search (fallback/boost)
  // Only search active facts
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const keywordResults = keywords.length > 0
    ? await prisma.memoryFact.findMany({
        where: {
          userId,
          isActive: true, // Note: Requires Prisma client regeneration after migration
          OR: keywords.flatMap(k => [
            { key: { contains: k, mode: 'insensitive' } },
            { value: { contains: k, mode: 'insensitive' } }
          ])
        } as any,
        take: limit
      })
    : [];

  // Merge results with scoring
  const resultMap = new Map<string, SearchResult<MemoryFact>>();

  // Add semantic results (score = 1 - distance, so closer = higher)
  for (const r of semanticResults) {
    // Cosine distance ranges from 0 (identical) to 2 (opposite)
    // We normalize to 0-1 where 1 is best
    const score = Math.max(0, 1 - (r.distance / 2));
    resultMap.set(r.id, {
      item: r,
      score,
      matchType: "semantic"
    });
  }

  // Boost keyword matches
  for (const r of keywordResults) {
    const existing = resultMap.get(r.id);
    if (existing) {
      existing.score += 0.3; // Boost for keyword match
      existing.matchType = "both";
    } else {
      resultMap.set(r.id, {
        item: r,
        score: 0.5, // Base score for keyword-only match
        matchType: "keyword"
      });
    }
  }

  // Sort by score and return
  return Array.from(resultMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Keyword-only search (fallback when embeddings unavailable)
 */
async function keywordSearchMemoryFacts({
  userId,
  query,
  limit
}: {
  userId: string;
  query: string;
  limit: number;
}): Promise<SearchResult<MemoryFact>[]> {
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (keywords.length === 0) return [];

  const results = await prisma.memoryFact.findMany({
    where: {
      userId,
      isActive: true, // Note: Requires Prisma client regeneration after migration
      OR: keywords.flatMap(k => [
        { key: { contains: k, mode: 'insensitive' } },
        { value: { contains: k, mode: 'insensitive' } }
      ])
    } as any,
    take: limit
  });

  return results.map(r => ({
    item: r,
    score: 0.5,
    matchType: "keyword" as const
  }));
}

/**
 * Search Knowledge using hybrid approach
 * Falls back to keyword-only search if embeddings are unavailable
 */
export async function searchKnowledge({
  emailAccountId,
  query,
  limit = 5
}: {
  emailAccountId: string;
  query: string;
  limit?: number;
}): Promise<SearchResult<Knowledge>[]> {
  try {
    // Try semantic search if embeddings are available
    if (EmbeddingService.isAvailable()) {
      return await hybridSearchKnowledge({ emailAccountId, query, limit });
    }

    // Fallback to keyword-only search
    return await keywordSearchKnowledge({ emailAccountId, query, limit });
  } catch (error) {
    logger.error("Knowledge search failed", { error, emailAccountId });
    
    // Final fallback to keyword search
    return await keywordSearchKnowledge({ emailAccountId, query, limit });
  }
}

/**
 * Hybrid search for Knowledge
 */
async function hybridSearchKnowledge({
  emailAccountId,
  query,
  limit
}: {
  emailAccountId: string;
  query: string;
  limit: number;
}): Promise<SearchResult<Knowledge>[]> {
  const queryEmbedding = await EmbeddingService.generateEmbedding(query);
  const vectorLiteral = toPgVectorLiteral(queryEmbedding);

  const semanticResults = await prisma.$queryRaw<(Knowledge & { distance: number })[]>`
    SELECT *, (embedding <=> ${Prisma.raw("'" + vectorLiteral + "'::vector")}) AS distance
    FROM "Knowledge"
    WHERE "emailAccountId" = ${emailAccountId}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${Prisma.raw("'" + vectorLiteral + "'::vector")}
    LIMIT ${limit}
  `;

  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const keywordResults = keywords.length > 0
    ? await prisma.knowledge.findMany({
        where: {
          emailAccountId,
          OR: keywords.flatMap(k => [
            { title: { contains: k, mode: 'insensitive' } },
            { content: { contains: k, mode: 'insensitive' } }
          ])
        },
        take: limit
      })
    : [];

  const resultMap = new Map<string, SearchResult<Knowledge>>();

  for (const r of semanticResults) {
    const score = Math.max(0, 1 - (r.distance / 2));
    resultMap.set(r.id, { item: r, score, matchType: "semantic" });
  }

  for (const r of keywordResults) {
    const existing = resultMap.get(r.id);
    if (existing) {
      existing.score += 0.3;
      existing.matchType = "both";
    } else {
      resultMap.set(r.id, { item: r, score: 0.5, matchType: "keyword" });
    }
  }

  return Array.from(resultMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Keyword-only search for Knowledge
 */
async function keywordSearchKnowledge({
  emailAccountId,
  query,
  limit
}: {
  emailAccountId: string;
  query: string;
  limit: number;
}): Promise<SearchResult<Knowledge>[]> {
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (keywords.length === 0) return [];

  const results = await prisma.knowledge.findMany({
    where: {
      emailAccountId,
      OR: keywords.flatMap(k => [
        { title: { contains: k, mode: 'insensitive' } },
        { content: { contains: k, mode: 'insensitive' } }
      ])
    },
    take: limit
  });

  return results.map(r => ({
    item: r,
    score: 0.5,
    matchType: "keyword" as const
  }));
}

// ============================================================================
// Semantic Deduplication
// ============================================================================

/**
 * Find semantically similar existing memory facts
 * Used to prevent storing duplicate facts with different wording
 * 
 * @param userId - User to check duplicates for
 * @param newFactText - Text of the new fact (key: value format)
 * @param threshold - Minimum similarity score to consider duplicate (0-1, default: 0.92)
 * @returns Array of potentially duplicate facts with their similarity scores
 */
export async function findSemanticDuplicates({
  userId,
  newFactText,
  threshold = 0.92
}: {
  userId: string;
  newFactText: string;
  threshold?: number;
}): Promise<Array<{ fact: MemoryFact; similarity: number }>> {
  // If embeddings unavailable, can't check semantic duplicates
  if (!EmbeddingService.isAvailable()) {
    logger.trace("Embedding service unavailable, skipping semantic dedupe");
    return [];
  }

  try {
    // Search for similar facts
    const results = await searchMemoryFacts({
      userId,
      query: newFactText,
      limit: 5
    });

    // Filter to high-similarity matches
    const duplicates = results
      .filter(r => r.score >= threshold)
      .map(r => ({
        fact: r.item,
        similarity: r.score
      }));

    if (duplicates.length > 0) {
      logger.trace("Found potential duplicates", {
        newFactText: newFactText.slice(0, 50),
        duplicateCount: duplicates.length,
        topSimilarity: duplicates[0]?.similarity
      });
    }

    return duplicates;
  } catch (error) {
    logger.warn("Semantic dedupe failed", { error, userId });
    return [];
  }
}

/**
 * Check if a new fact would be a duplicate of an existing one
 * 
 * @param userId - User to check for
 * @param key - The key of the new fact
 * @param value - The value of the new fact
 * @returns The existing duplicate fact if found, null otherwise
 */
export async function checkForDuplicate({
  userId,
  key,
  value
}: {
  userId: string;
  key: string;
  value: string;
}): Promise<MemoryFact | null> {
  const text = `${key}: ${value}`;
  const duplicates = await findSemanticDuplicates({
    userId,
    newFactText: text,
    threshold: 0.92
  });

  if (duplicates.length > 0) {
    // Return the most similar duplicate
    return duplicates[0].fact;
  }

  return null;
}
