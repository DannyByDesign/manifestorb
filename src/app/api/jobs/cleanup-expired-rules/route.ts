/**
 * Cleanup Expired Rules Job
 *
 * Disables temporary rules that have expired.
 *
 * Cron Schedule: "0 5 * * *" (daily at 5:00 AM UTC)
 */
import { NextResponse } from "next/server";
import { env } from "@/env";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("jobs/cleanup-expired-rules");

export const maxDuration = 300;

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const validCron = env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
  const validJob = env.JOBS_SHARED_SECRET && authHeader === `Bearer ${env.JOBS_SHARED_SECRET}`;

  if (!validCron && !validJob) {
    logger.warn("Unauthorized request to cleanup-expired-rules");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const now = new Date();
    const result = await prisma.rule.updateMany({
      where: {
        enabled: true,
        isTemporary: true,
        expiresAt: { lte: now },
      },
      data: {
        enabled: false,
      },
    });

    logger.info("Expired temporary rules disabled", { count: result.count });
    return NextResponse.json({ success: true, disabled: result.count });
  } catch (error) {
    logger.error("Cleanup expired rules failed", { error });
    return NextResponse.json({ error: "Cleanup job failed" }, { status: 500 });
  }
}
