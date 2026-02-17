import { NextResponse } from "next/server";
import { env } from "@/env";
import { createScopedLogger } from "@/server/lib/logger";
import { SearchIndexQueue } from "@/server/features/search/index/queue";
import {
  listSearchFreshnessByConnector,
  listSearchIngestionLag,
} from "@/server/features/search/index/repository";

const logger = createScopedLogger("jobs/process-search-index");

export const maxDuration = 300;

function hasValidAuth(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  const validCron = env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
  const validJob = env.JOBS_SHARED_SECRET && authHeader === `Bearer ${env.JOBS_SHARED_SECRET}`;
  return Boolean(validCron || validJob);
}

async function loadHealthSnapshot() {
  const [queue, lag, freshness] = await Promise.all([
    SearchIndexQueue.getStats(),
    listSearchIngestionLag(),
    listSearchFreshnessByConnector(),
  ]);
  return { queue, lag, freshness };
}

export async function GET(request: Request) {
  if (!hasValidAuth(request)) {
    logger.warn("Unauthorized request to read process-search-index health");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const snapshot = await loadHealthSnapshot();
    return NextResponse.json({
      success: true,
      ...snapshot,
    });
  } catch (error) {
    logger.error("Search index queue health read failed", { error });
    return NextResponse.json(
      { success: false, error: "search_index_health_failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasValidAuth(request)) {
    logger.warn("Unauthorized request to process-search-index");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: "process" | "retry_failed" | "health";
      maxJobs?: number;
    };
    const action = body.action ?? "process";
    const maxJobs =
      typeof body.maxJobs === "number" && Number.isFinite(body.maxJobs)
        ? Math.max(1, Math.min(2000, Math.trunc(body.maxJobs)))
        : 100;

    let recovered = 0;
    let processed = 0;
    let retried = 0;

    if (action === "retry_failed") {
      retried = await SearchIndexQueue.retryFailed();
      recovered = await SearchIndexQueue.recoverStale();
      processed = await SearchIndexQueue.processAll(maxJobs);
    } else if (action === "process") {
      recovered = await SearchIndexQueue.recoverStale();
      processed = await SearchIndexQueue.processAll(maxJobs);
    }
    const snapshot = await loadHealthSnapshot();

    logger.info("Search index queue processed", {
      action,
      recovered,
      processed,
      retried,
      ...snapshot.queue,
    });

    return NextResponse.json({
      success: true,
      action,
      recovered,
      processed,
      retried,
      ...snapshot,
    });
  } catch (error) {
    logger.error("Search index queue processing failed", { error });
    return NextResponse.json(
      { success: false, error: "search_index_processing_failed" },
      { status: 500 },
    );
  }
}
