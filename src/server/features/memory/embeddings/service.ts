/**
 * Embedding service for semantic search
 * Uses OpenAI text-embedding-3-small model
 * 
 * Part of the context and memory management system.
 * 
 * Features:
 * - Retry logic with exponential backoff for transient failures
 * - Rate limit (429) and server error (503) handling
 * - Timeout configuration
 * - Cost tracking integration
 */
import OpenAI from "openai";
import { env } from "@/env";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("EmbeddingService");

// ============================================================================
// Configuration
// ============================================================================

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000]; // Exponential backoff
const REQUEST_TIMEOUT_MS = 30000; // 30 second timeout

// Embedding dimension for text-embedding-3-small
export const EMBEDDING_DIMENSION = 1536;
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const MAX_INPUT_CHARS = 30000; // ~7500 tokens, safe under 8191 limit

// ============================================================================
// OpenAI Client
// ============================================================================

// Lazy initialization to avoid startup errors if key missing
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required for embeddings");
    }
    openaiClient = new OpenAI({ 
      apiKey: env.OPENAI_API_KEY,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 0, // We handle retries ourselves for better control
    });
  }
  return openaiClient;
}

// ============================================================================
// Retry Logic
// ============================================================================

interface RetryableError {
  status?: number;
  code?: string;
  message?: string;
}

function isRetryableError(error: RetryableError): boolean {
  // Rate limit
  if (error.status === 429) return true;
  // Server errors
  if (error.status === 500 || error.status === 502 || error.status === 503) return true;
  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') return true;
  // Timeout
  if (error.message?.includes('timeout')) return true;
  return false;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  operation: string
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error as Error;
      const retryableError = error as RetryableError;
      
      // Check if we should retry
      if (!isRetryableError(retryableError) || attempt === MAX_RETRIES) {
        logger.error(`${operation} failed permanently`, { 
          error: lastError.message,
          attempt,
          status: retryableError.status,
          code: retryableError.code,
        });
        throw error;
      }
      
      // Wait before retrying
      const delay = RETRY_DELAYS_MS[attempt] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      logger.warn(`${operation} failed, retrying in ${delay}ms`, {
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        error: lastError.message,
        status: retryableError.status,
      });
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // Should never reach here, but TypeScript needs this
  throw lastError;
}

export class EmbeddingService {
  /**
   * Generate embedding for a single text
   * 
   * Features:
   * - Redis cache layer (24h TTL)
   * - Automatic retry with exponential backoff
   * - Handles rate limits and transient failures
   * - Truncates long text to stay within token limits
   * 
   * @param text - The text to embed
   * @param email - Optional email for cost tracking
   * @param skipCache - Skip cache lookup (for fresh embeddings)
   * @returns The embedding vector (1536 dimensions)
   */
  static async generateEmbedding(
    text: string, 
    email?: string,
    skipCache = false
  ): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error("Cannot generate embedding for empty text");
    }

    // Truncate to avoid token limits
    const truncatedText = text.slice(0, MAX_INPUT_CHARS);
    const wasTruncated = text.length > MAX_INPUT_CHARS;
    
    if (wasTruncated) {
      logger.trace("Text truncated for embedding", { 
        originalLength: text.length, 
        truncatedLength: truncatedText.length 
      });
    }

    // Check cache first (unless skipped)
    if (!skipCache) {
      try {
        const { getCachedEmbedding } = await import("./cache");
        const cached = await getCachedEmbedding(truncatedText);
        if (cached) {
          logger.trace("Embedding served from cache");
          return cached;
        }
      } catch (e) {
        logger.warn("Cache lookup failed, proceeding to API", { error: e });
      }
    }

    // Generate new embedding
    const embedding = await withRetry(
      async () => {
        const response = await getOpenAI().embeddings.create({
          model: EMBEDDING_MODEL,
          input: truncatedText,
        });
        return response.data[0].embedding;
      },
      'generateEmbedding'
    );

    // Cache the result (fire and forget)
    try {
      const { cacheEmbedding } = await import("./cache");
      cacheEmbedding(truncatedText, embedding).catch(() => {});
    } catch {
      // Ignore cache errors
    }

    // Track usage (fire and forget to avoid blocking)
    if (email) {
      this.trackUsage(email, truncatedText.length).catch(e => 
        logger.warn("Failed to track embedding usage", { error: e })
      );
    }

    return embedding;
  }

  /**
   * Generate embeddings for multiple texts (batch)
   * More efficient than calling generateEmbedding multiple times
   * 
   * Features:
   * - Redis cache layer for each text
   * - Only calls API for cache misses
   * 
   * Note: Returns embeddings in same order as input texts.
   * Empty/invalid texts are filtered out, so output length may differ from input.
   * 
   * @param texts - Array of texts to embed
   * @param email - Optional email for cost tracking
   * @param skipCache - Skip cache lookup
   * @returns Array of embedding vectors
   */
  static async generateEmbeddings(
    texts: string[], 
    email?: string,
    skipCache = false
  ): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Filter empty texts and track original indices
    const validEntries = texts
      .map((t, i) => ({ text: t, index: i }))
      .filter(e => e.text && e.text.trim().length > 0);
    
    if (validEntries.length === 0) return [];

    // Truncate each text
    const truncatedTexts = validEntries.map(e => e.text.slice(0, MAX_INPUT_CHARS));

    // Check cache for each text
    const results: number[][] = new Array(truncatedTexts.length);
    const cacheMisses: Array<{ text: string; index: number }> = [];

    if (!skipCache) {
      try {
        const { getCachedEmbeddings } = await import("./cache");
        const cachedMap = await getCachedEmbeddings(truncatedTexts);
        
        for (let i = 0; i < truncatedTexts.length; i++) {
          const cached = cachedMap.get(truncatedTexts[i]);
          if (cached) {
            results[i] = cached;
          } else {
            cacheMisses.push({ text: truncatedTexts[i], index: i });
          }
        }
        
        logger.trace("Batch cache lookup", {
          total: truncatedTexts.length,
          hits: truncatedTexts.length - cacheMisses.length,
          misses: cacheMisses.length
        });
      } catch {
        // On cache error, treat all as misses
        for (let i = 0; i < truncatedTexts.length; i++) {
          cacheMisses.push({ text: truncatedTexts[i], index: i });
        }
      }
    } else {
      // Skip cache - all are misses
      for (let i = 0; i < truncatedTexts.length; i++) {
        cacheMisses.push({ text: truncatedTexts[i], index: i });
      }
    }

    // Generate embeddings for cache misses
    if (cacheMisses.length > 0) {
      const missTexts = cacheMisses.map(m => m.text);
      const totalChars = missTexts.reduce((sum, t) => sum + t.length, 0);

      const newEmbeddings = await withRetry(
        async () => {
          const response = await getOpenAI().embeddings.create({
            model: EMBEDDING_MODEL,
            input: missTexts,
          });
          return response.data.map(d => d.embedding);
        },
        'generateEmbeddings'
      );

      // Place new embeddings in results and cache them
      const toCache: Array<[string, number[]]> = [];
      for (let i = 0; i < cacheMisses.length; i++) {
        const { text, index } = cacheMisses[i];
        results[index] = newEmbeddings[i];
        toCache.push([text, newEmbeddings[i]]);
      }

      // Cache new embeddings (fire and forget)
      try {
        const { cacheEmbeddings } = await import("./cache");
        cacheEmbeddings(toCache).catch(() => {});
      } catch {
        // Ignore cache errors
      }

      // Track usage for API calls only
      if (email) {
        this.trackUsage(email, totalChars).catch(e => 
          logger.warn("Failed to track batch embedding usage", { error: e })
        );
      }
    }

    return results;
  }

  /**
   * Track embedding API usage for cost monitoring
   * @internal
   */
  private static async trackUsage(email: string, inputChars: number): Promise<void> {
    // Lazy import to avoid circular dependencies
    const { saveEmbeddingUsage } = await import("@/server/lib/redis/usage");
    await saveEmbeddingUsage({ email, inputChars });
  }

  /**
   * Compute cosine similarity between two vectors
   * Returns a value between -1 and 1, where 1 is identical
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have same dimension");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }

  /**
   * Check if the embedding service is available
   * Returns true if OPENAI_API_KEY is configured
   */
  static isAvailable(): boolean {
    return !!env.OPENAI_API_KEY;
  }
}
