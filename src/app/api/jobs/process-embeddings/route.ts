/**
 * Embedding Queue Worker
 * 
 * Cron job endpoint that processes pending embedding jobs.
 * Should be called every 5 minutes (or based on volume).
 * 
 * Cron Schedule: "0/5 * * * *" (every 5 minutes)
 */
import { NextResponse } from "next/server";
import { env } from "@/env";
import { EmbeddingQueue } from "@/features/memory/embeddings/queue";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("jobs/process-embeddings");

export const maxDuration = 300; // 5 minutes max

export async function POST(request: Request) {
    // Auth check - accepts either CRON_SECRET or JOBS_SHARED_SECRET
    const authHeader = request.headers.get("Authorization");
    const validCron = env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
    const validJob = env.JOBS_SHARED_SECRET && authHeader === `Bearer ${env.JOBS_SHARED_SECRET}`;
    
    if (!validCron && !validJob) {
        logger.warn("Unauthorized request to process-embeddings");
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        // Recover any stale jobs first (jobs stuck in processing)
        const recovered = await EmbeddingQueue.recoverStale();
        
        // Process pending jobs (up to 50 per run)
        const processed = await EmbeddingQueue.processAll(50);
        
        // Get final stats for monitoring
        const stats = await EmbeddingQueue.getStats();

        logger.info("Embedding queue processed", { recovered, processed, ...stats });

        return NextResponse.json({
            success: true,
            recovered,
            processed,
            queue: stats
        });
    } catch (error) {
        logger.error("Embedding queue processing failed", { error });
        return NextResponse.json(
            { error: "Processing failed" },
            { status: 500 }
        );
    }
}
