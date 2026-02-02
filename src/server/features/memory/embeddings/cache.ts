/**
 * Embedding Cache Layer
 * 
 * Caches embedding vectors in Redis to avoid duplicate API calls.
 * Uses content hash as key for cache lookup.
 * 
 * Cache Strategy:
 * - TTL: 24 hours (embeddings don't change for the same text)
 * - Key: SHA256 hash of text (first 16 chars)
 * - Value: JSON array of embedding values
 */
import { createHash } from "crypto";
import { redis } from "@/server/lib/redis";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("EmbeddingCache");

// ============================================================================
// Configuration
// ============================================================================

const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const CACHE_PREFIX = "emb:";

// ============================================================================
// Cache Operations
// ============================================================================

/**
 * Generate cache key from text content
 */
function getCacheKey(text: string): string {
  const hash = createHash('sha256')
    .update(text)
    .digest('hex')
    .slice(0, 16); // Use first 16 chars of hash
  return `${CACHE_PREFIX}${hash}`;
}

/**
 * Get a cached embedding for the given text
 * 
 * @param text - The text to look up
 * @returns The cached embedding or null if not found
 */
export async function getCachedEmbedding(text: string): Promise<number[] | null> {
  try {
    const key = getCacheKey(text);
    const cached = await redis.get(key);
    
    if (cached) {
      logger.trace("Embedding cache hit", { keyPrefix: key.slice(0, 10) });
      // Parse the cached value
      if (typeof cached === 'string') {
        return JSON.parse(cached);
      }
      return cached as number[];
    }
    
    return null;
  } catch (error) {
    logger.warn("Cache read failed", { error });
    return null;
  }
}

/**
 * Store an embedding in the cache
 * 
 * @param text - The text that was embedded
 * @param embedding - The embedding vector
 */
export async function cacheEmbedding(text: string, embedding: number[]): Promise<void> {
  try {
    const key = getCacheKey(text);
    // Store as JSON string (embeddings are ~6KB each)
    await redis.set(key, JSON.stringify(embedding), { ex: CACHE_TTL_SECONDS });
    logger.trace("Embedding cached", { keyPrefix: key.slice(0, 10) });
  } catch (error) {
    // Don't fail on cache write errors
    logger.warn("Cache write failed", { error });
  }
}

/**
 * Get multiple cached embeddings at once
 * 
 * @param texts - Array of texts to look up
 * @returns Map of text to embedding (only found entries)
 */
export async function getCachedEmbeddings(texts: string[]): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  
  if (texts.length === 0) return result;
  
  try {
    // Build keys and execute pipeline
    const keys = texts.map(t => getCacheKey(t));
    const cached = await redis.mget(...keys);
    
    for (let i = 0; i < texts.length; i++) {
      const value = cached[i];
      if (value) {
        try {
          const embedding = typeof value === 'string' ? JSON.parse(value) : value;
          result.set(texts[i], embedding);
        } catch {
          // Skip invalid cache entries
        }
      }
    }
    
    if (result.size > 0) {
      logger.trace("Batch cache hit", { 
        requested: texts.length, 
        found: result.size 
      });
    }
  } catch (error) {
    logger.warn("Batch cache read failed", { error });
  }
  
  return result;
}

/**
 * Cache multiple embeddings at once
 * 
 * @param entries - Array of [text, embedding] pairs
 */
export async function cacheEmbeddings(
  entries: Array<[string, number[]]>
): Promise<void> {
  if (entries.length === 0) return;
  
  try {
    // Use pipeline for efficient batch write
    const pipeline = redis.pipeline();
    
    for (const [text, embedding] of entries) {
      const key = getCacheKey(text);
      pipeline.set(key, JSON.stringify(embedding), { ex: CACHE_TTL_SECONDS });
    }
    
    await pipeline.exec();
    logger.trace("Batch cache write", { count: entries.length });
  } catch (error) {
    logger.warn("Batch cache write failed", { error });
  }
}

/**
 * Invalidate a cached embedding
 * 
 * @param text - The text whose embedding should be invalidated
 */
export async function invalidateCachedEmbedding(text: string): Promise<void> {
  try {
    const key = getCacheKey(text);
    await redis.del(key);
    logger.trace("Cache entry invalidated", { keyPrefix: key.slice(0, 10) });
  } catch (error) {
    logger.warn("Cache invalidation failed", { error });
  }
}

/**
 * Get cache statistics (approximate)
 */
export async function getCacheStats(): Promise<{
  approximateSize: number;
}> {
  try {
    // Count keys with our prefix (approximate)
    // Note: This is expensive on large datasets, use sparingly
    const keys = await redis.keys(`${CACHE_PREFIX}*`);
    return { approximateSize: keys.length };
  } catch (error) {
    logger.warn("Failed to get cache stats", { error });
    return { approximateSize: 0 };
  }
}
