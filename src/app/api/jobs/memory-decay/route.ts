/**
 * Memory Decay Job
 * 
 * Cron job endpoint that manages memory lifecycle:
 * 1. Marks stale memories as inactive (180+ days without access)
 * 2. Permanently deletes inactive memories (30+ days inactive)
 * 
 * Cron Schedule: "0 3 * * *" (daily at 3:00 AM UTC)
 */
import { NextResponse } from "next/server";
import { env } from "@/env";
import { pruneStaleMemories, purgeInactiveMemories } from "@/features/memory/decay";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("jobs/memory-decay");

export const maxDuration = 300; // 5 minutes max

export async function POST(request: Request) {
    // Auth check - accepts either CRON_SECRET or JOBS_SHARED_SECRET
    const authHeader = request.headers.get("Authorization");
    const validCron = env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
    const validJob = env.JOBS_SHARED_SECRET && authHeader === `Bearer ${env.JOBS_SHARED_SECRET}`;
    
    if (!validCron && !validJob) {
        logger.warn("Unauthorized request to memory-decay");
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        // 1. Mark stale memories as inactive (180+ days without access)
        const pruned = await pruneStaleMemories();
        
        // 2. Permanently delete inactive memories (30+ days inactive)
        const purged = await purgeInactiveMemories(30);

        logger.info("Memory decay complete", { pruned, purged });

        return NextResponse.json({
            success: true,
            pruned,
            purged
        });
    } catch (error) {
        logger.error("Memory decay failed", { error });
        return NextResponse.json(
            { error: "Decay job failed" },
            { status: 500 }
        );
    }
}
