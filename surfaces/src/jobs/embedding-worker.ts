/**
 * Embedding Queue Worker
 * 
 * Processes pending embedding jobs from the Redis queue.
 * Generates embeddings via OpenAI and stores them in the database.
 * 
 * This worker runs in the surfaces sidecar with no timeout constraints.
 */
import { redis } from '../db/redis';
import { prisma } from '../db/prisma';

// Queue keys (must match main app's EmbeddingQueue)
const QUEUE_KEY = 'embedding:queue';
const PROCESSING_KEY = 'embedding:processing';
const FAILED_KEY = 'embedding:failed';
const MAX_RETRIES = 3;
const PROCESSING_TIMEOUT_MS = 60000; // 1 minute

// Job interface (must match main app)
interface EmbeddingJob {
    id: string;
    table: 'MemoryFact' | 'Knowledge';
    recordId: string;
    text: string;
    email?: string;
    retries: number;
    createdAt: number;
    lastError?: string;
}

/**
 * Process pending embedding jobs from the queue
 * 
 * @param maxJobs - Maximum number of jobs to process in this run
 * @returns Number of jobs processed
 */
export async function processEmbeddingQueue(maxJobs = 50): Promise<number> {
    if (!redis) {
        console.log('[Embedding] Redis not configured, skipping');
        return 0;
    }

    let processed = 0;

    while (processed < maxJobs) {
        // Pop job from queue
        const jobJson = await redis.rpop(QUEUE_KEY);
        if (!jobJson) break; // Queue is empty

        const job: EmbeddingJob = JSON.parse(jobJson);

        console.log(`[Embedding] Processing job ${job.id} (${job.table}:${job.recordId})`);

        try {
            // Generate embedding via OpenAI
            const embedding = await generateEmbedding(job.text);

            // Store in database
            await storeEmbedding(job.table, job.recordId, embedding);

            processed++;
            console.log(`[Embedding] Completed job ${job.id}`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[Embedding] Failed job ${job.id}:`, errorMessage);

            // Retry or move to failed queue
            if (job.retries < MAX_RETRIES) {
                const retryJob: EmbeddingJob = {
                    ...job,
                    retries: job.retries + 1,
                    lastError: errorMessage,
                };
                await redis.lpush(QUEUE_KEY, JSON.stringify(retryJob));
                console.log(`[Embedding] Job ${job.id} queued for retry (attempt ${retryJob.retries})`);
            } else {
                const failedJob: EmbeddingJob = {
                    ...job,
                    lastError: errorMessage,
                };
                await redis.lpush(FAILED_KEY, JSON.stringify(failedJob));
                console.warn(`[Embedding] Job ${job.id} moved to failed queue after max retries`);
            }
        }
    }

    return processed;
}

/**
 * Recover stale jobs that have been processing too long
 * Called before processing to handle crashed workers
 */
export async function recoverStaleJobs(): Promise<number> {
    if (!redis) return 0;

    const processingJobs = await redis.lrange(PROCESSING_KEY, 0, -1);
    let recovered = 0;

    for (const jobJson of processingJobs) {
        const job: EmbeddingJob = JSON.parse(jobJson);
        const age = Date.now() - job.createdAt;

        if (age > PROCESSING_TIMEOUT_MS) {
            // Move back to main queue
            await redis.lrem(PROCESSING_KEY, 1, jobJson);
            await redis.lpush(QUEUE_KEY, JSON.stringify(job));
            recovered++;
            console.warn(`[Embedding] Recovered stale job ${job.id} (age: ${Math.round(age / 1000)}s)`);
        }
    }

    return recovered;
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
    pending: number;
    processing: number;
    failed: number;
}> {
    if (!redis) return { pending: 0, processing: 0, failed: 0 };

    const [pending, processing, failed] = await Promise.all([
        redis.llen(QUEUE_KEY),
        redis.llen(PROCESSING_KEY),
        redis.llen(FAILED_KEY),
    ]);

    return { pending, processing, failed };
}

/**
 * Generate embedding using OpenAI API
 */
async function generateEmbedding(text: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY not configured');
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: text
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
}

/**
 * Store embedding in the appropriate database table
 */
async function storeEmbedding(
    table: 'MemoryFact' | 'Knowledge',
    recordId: string,
    embedding: number[]
): Promise<void> {
    // Format as PostgreSQL vector literal
    const vectorStr = `[${embedding.join(',')}]`;

    if (table === 'MemoryFact') {
        await prisma.$executeRaw`
            UPDATE "MemoryFact"
            SET embedding = ${vectorStr}::vector
            WHERE id = ${recordId}
        `;
    } else if (table === 'Knowledge') {
        await prisma.$executeRaw`
            UPDATE "Knowledge"
            SET embedding = ${vectorStr}::vector
            WHERE id = ${recordId}
        `;
    }
}
