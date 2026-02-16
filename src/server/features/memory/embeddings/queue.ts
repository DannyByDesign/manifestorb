/**
 * Embedding Queue - Reliable job processing for embedding generation
 * 
 * Replaces fire-and-forget patterns with a reliable Redis-backed queue.
 * Jobs are persisted and can be retried on failure.
 * 
 * Usage:
 * - EmbeddingQueue.enqueue() to add a job
 * - EmbeddingQueue.processNext() to process pending jobs (called by worker)
 * - EmbeddingQueue.retryFailed() to retry failed jobs
 */
import { redis } from "@/server/lib/redis";
import { createScopedLogger } from "@/server/lib/logger";
import { EmbeddingService } from "./service";
import prisma from "@/server/db/client";

const logger = createScopedLogger("EmbeddingQueue");

// ============================================================================
// Configuration
// ============================================================================

const QUEUE_KEY = "embedding:queue";
const PROCESSING_KEY = "embedding:processing";
const FAILED_KEY = "embedding:failed";
const MAX_RETRIES = 3;
const PROCESSING_TIMEOUT_MS = 60000; // 1 minute

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingJob {
  id: string;
  table: "MemoryFact" | "Knowledge" | "ConversationMessage";
  recordId: string;
  text: string;
  email?: string;
  retries: number;
  createdAt: number;
  lastError?: string;
}

// ============================================================================
// Queue Operations
// ============================================================================

export class EmbeddingQueue {
  /**
   * Add a job to the embedding queue
   * 
   * @param job - Job details (table, recordId, text)
   * @returns Job ID
   */
  static async enqueue(job: Omit<EmbeddingJob, "id" | "retries" | "createdAt">): Promise<string> {
    if (!job.text || job.text.trim().length === 0) {
      throw new Error("embedding_job_text_required");
    }
    const id = `emb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const fullJob: EmbeddingJob = {
      ...job,
      id,
      retries: 0,
      createdAt: Date.now(),
    };
    
    await redis.lpush(QUEUE_KEY, JSON.stringify(fullJob));
    
    logger.trace("Job enqueued", { id, table: job.table, recordId: job.recordId });
    
    return id;
  }

  /**
   * Process the next job in the queue
   * 
   * @returns True if a job was processed, false if queue is empty
   */
  static async processNext(): Promise<boolean> {
    // Pop job from queue (Upstash doesn't support rpoplpush, so we do it in two steps)
    const jobJson = await redis.rpop(QUEUE_KEY);
    
    if (!jobJson) {
      return false; // Queue is empty
    }
    
    // Add to processing queue
    await redis.lpush(PROCESSING_KEY, jobJson);
    
    const job: EmbeddingJob = JSON.parse(jobJson as string);
    
    logger.info("Processing embedding job", { id: job.id, table: job.table, recordId: job.recordId });
    
    try {
      // Generate embedding
      const embedding = await EmbeddingService.generateEmbedding(job.text, job.email);
      
      // Store in database
      await this.storeEmbedding(job.table, job.recordId, embedding);
      
      // Remove from processing queue
      await redis.lrem(PROCESSING_KEY, 1, jobJson);
      
      logger.info("Job completed successfully", { id: job.id });
      return true;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Job failed", { id: job.id, error: errorMessage, retries: job.retries });
      
      // Remove from processing queue
      await redis.lrem(PROCESSING_KEY, 1, jobJson);
      
      // Retry or move to failed queue
      if (job.retries < MAX_RETRIES) {
        const retryJob: EmbeddingJob = {
          ...job,
          retries: job.retries + 1,
          lastError: errorMessage,
        };
        await redis.lpush(QUEUE_KEY, JSON.stringify(retryJob));
        logger.info("Job queued for retry", { id: job.id, retries: retryJob.retries });
      } else {
        const failedJob: EmbeddingJob = {
          ...job,
          lastError: errorMessage,
        };
        await redis.lpush(FAILED_KEY, JSON.stringify(failedJob));
        logger.warn("Job moved to failed queue after max retries", { id: job.id });
      }
      
      return true; // We processed something (even if it failed)
    }
  }

  /**
   * Store embedding in the appropriate database table
   */
  private static async storeEmbedding(
    table: "MemoryFact" | "Knowledge" | "ConversationMessage",
    recordId: string,
    embedding: number[]
  ): Promise<void> {
    if (table === "MemoryFact") {
      await prisma.$executeRaw`
        UPDATE "MemoryFact"
        SET embedding = ${embedding}::vector
        WHERE id = ${recordId}
      `;
    } else if (table === "Knowledge") {
      await prisma.$executeRaw`
        UPDATE "Knowledge"
        SET embedding = ${embedding}::vector
        WHERE id = ${recordId}
      `;
    } else if (table === "ConversationMessage") {
      await prisma.$executeRaw`
        UPDATE "ConversationMessage"
        SET embedding = ${embedding}::vector
        WHERE id = ${recordId}
      `;
    }
  }

  /**
   * Get queue statistics
   */
  static async getStats(): Promise<{
    pending: number;
    processing: number;
    failed: number;
  }> {
    const [pending, processing, failed] = await Promise.all([
      redis.llen(QUEUE_KEY),
      redis.llen(PROCESSING_KEY),
      redis.llen(FAILED_KEY),
    ]);
    
    return { pending, processing, failed };
  }

  /**
   * Retry all failed jobs (move back to main queue)
   * 
   * @returns Number of jobs moved
   */
  static async retryFailed(): Promise<number> {
    let count = 0;
    
    while (true) {
      // Pop from failed queue (Upstash doesn't support rpoplpush)
      const jobJson = await redis.rpop(FAILED_KEY);
      if (!jobJson) break;
      
      // Reset retry count
      const job: EmbeddingJob = JSON.parse(jobJson as string);
      job.retries = 0;
      job.lastError = undefined;
      
      // Add updated job to main queue
      await redis.lpush(QUEUE_KEY, JSON.stringify(job));
      
      count++;
    }
    
    if (count > 0) {
      logger.info("Moved failed jobs back to queue", { count });
    }
    
    return count;
  }

  /**
   * Recover stale processing jobs (jobs that have been processing too long)
   * Should be called periodically to handle crashed workers
   * 
   * @returns Number of jobs recovered
   */
  static async recoverStale(): Promise<number> {
    const processingJobs = await redis.lrange(PROCESSING_KEY, 0, -1);
    let recovered = 0;
    
    for (const jobJson of processingJobs) {
      const job: EmbeddingJob = JSON.parse(jobJson as string);
      const age = Date.now() - job.createdAt;
      
      if (age > PROCESSING_TIMEOUT_MS) {
        // Move back to main queue
        await redis.lrem(PROCESSING_KEY, 1, jobJson);
        await redis.lpush(QUEUE_KEY, JSON.stringify(job));
        recovered++;
        logger.warn("Recovered stale job", { id: job.id, ageMs: age });
      }
    }
    
    return recovered;
  }

  /**
   * Process all pending jobs (batch processing)
   * 
   * @param maxJobs - Maximum number of jobs to process (default: 100)
   * @returns Number of jobs processed
   */
  static async processAll(maxJobs = 100): Promise<number> {
    let processed = 0;
    
    while (processed < maxJobs) {
      const hadJob = await this.processNext();
      if (!hadJob) break;
      processed++;
    }
    
    if (processed > 0) {
      logger.info("Batch processing complete", { processed });
    }
    
    return processed;
  }
}
