/**
 * Scheduling Reason Cleanup Job
 *
 * Deletes expired task scheduling reasons (30-day TTL enforced by expiresAt).
 *
 * Cron Schedule: "0 4 * * *" (daily at 4:00 AM UTC)
 */
import { NextResponse } from "next/server";
import { env } from "@/env";
import { createScopedLogger } from "@/server/lib/logger";
import { cleanupExpiredSchedulingReasons } from "@/features/calendar/scheduling/TaskSchedulingService";

const logger = createScopedLogger("jobs/cleanup-scheduling-reasons");

export const maxDuration = 300;

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const validCron = env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
  const validJob = env.JOBS_SHARED_SECRET && authHeader === `Bearer ${env.JOBS_SHARED_SECRET}`;

  if (!validCron && !validJob) {
    logger.warn("Unauthorized request to cleanup scheduling reasons");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const deleted = await cleanupExpiredSchedulingReasons();
    logger.info("Scheduling reason cleanup complete", { deleted });
    return NextResponse.json({ success: true, deleted });
  } catch (error) {
    logger.error("Scheduling reason cleanup failed", { error });
    return NextResponse.json({ error: "Cleanup job failed" }, { status: 500 });
  }
}
