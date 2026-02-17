import { NextResponse } from "next/server";
import { env } from "@/env";
import { createScopedLogger } from "@/server/lib/logger";
import { SearchIndexQueue } from "@/server/features/search/index/queue";

const logger = createScopedLogger("jobs/process-search-index");

export const maxDuration = 300;

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const validCron = env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
  const validJob = env.JOBS_SHARED_SECRET && authHeader === `Bearer ${env.JOBS_SHARED_SECRET}`;

  if (!validCron && !validJob) {
    logger.warn("Unauthorized request to process-search-index");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const recovered = await SearchIndexQueue.recoverStale();
    const processed = await SearchIndexQueue.processAll(100);
    const stats = await SearchIndexQueue.getStats();

    logger.info("Search index queue processed", {
      recovered,
      processed,
      ...stats,
    });

    return NextResponse.json({
      success: true,
      recovered,
      processed,
      queue: stats,
    });
  } catch (error) {
    logger.error("Search index queue processing failed", { error });
    return NextResponse.json(
      { success: false, error: "search_index_processing_failed" },
      { status: 500 },
    );
  }
}
