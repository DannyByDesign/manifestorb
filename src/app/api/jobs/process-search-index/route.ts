import { NextResponse } from "next/server";
import { env } from "@/env";
import { createScopedLogger } from "@/server/lib/logger";
import { SearchIndexQueue } from "@/server/features/search/index/queue";
import {
  listSearchFreshnessByConnector,
  listSearchIngestionLag,
} from "@/server/features/search/index/repository";
import { runSearchBackfill } from "@/server/features/search/index/backfill";
import type { SearchConnector } from "@/server/features/search/index/types";

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
      action?: "process" | "retry_failed" | "health" | "backfill_user";
      maxJobs?: number;
      userId?: string;
      emailAccountId?: string;
      connectors?: SearchConnector[];
      memoryMaxItems?: number;
    };
    const action = body.action ?? "process";
    const maxJobs =
      typeof body.maxJobs === "number" && Number.isFinite(body.maxJobs)
        ? Math.max(1, Math.min(2000, Math.trunc(body.maxJobs)))
        : 100;

    let recovered = 0;
    let processed = 0;
    let retried = 0;

    let backfill:
      | {
          connectors: SearchConnector[];
          queued: number;
          byConnector: Record<SearchConnector, number>;
        }
      | undefined;

    if (action === "retry_failed") {
      retried = await SearchIndexQueue.retryFailed();
      recovered = await SearchIndexQueue.recoverStale();
      processed = await SearchIndexQueue.processAll(maxJobs);
    } else if (action === "backfill_user") {
      if (!body.userId || typeof body.userId !== "string") {
        return NextResponse.json(
          { success: false, error: "backfill_user_requires_userId" },
          { status: 400 },
        );
      }
      backfill = await runSearchBackfill({
        userId: body.userId,
        emailAccountId:
          typeof body.emailAccountId === "string" ? body.emailAccountId : undefined,
        connectors: Array.isArray(body.connectors)
          ? body.connectors.filter((connector): connector is SearchConnector => connector === "memory")
          : undefined,
        memoryMaxItems:
          typeof body.memoryMaxItems === "number" ? body.memoryMaxItems : undefined,
        logger,
      });
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
      backfill,
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
