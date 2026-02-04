import { NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { ensureGoogleCalendarWatch } from "@/features/calendar/sync/google";
import { createScopedLogger } from "@/server/lib/logger";
import { env } from "@/env";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

export const maxDuration = 300;

export const POST = verifySignatureAppRouter(async (req: Request) => {
  const logger = createScopedLogger("cron/calendar-watch-renewal");
  const authHeader = req.headers.get("authorization");

  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    logger.warn("Unauthorized attempt to renew calendar watches");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const calendars = await prisma.calendar.findMany({
      where: {
        connection: { isConnected: true, provider: "google" },
      },
      include: {
        connection: {
          select: {
            emailAccountId: true,
            accessToken: true,
            refreshToken: true,
            expiresAt: true,
          },
        },
      },
    });

    let successCount = 0;
    let errorCount = 0;
    const renewWindowMs = 24 * 60 * 60 * 1000;

    for (const calendar of calendars) {
      try {
        await ensureGoogleCalendarWatch({
          calendar: {
            id: calendar.id,
            calendarId: calendar.calendarId,
            googleSyncToken: calendar.googleSyncToken,
            googleChannelId: calendar.googleChannelId,
            googleResourceId: calendar.googleResourceId,
            googleChannelToken: calendar.googleChannelToken,
            googleChannelExpiresAt: calendar.googleChannelExpiresAt,
          },
          connection: {
            accessToken: calendar.connection.accessToken,
            refreshToken: calendar.connection.refreshToken,
            expiresAt: calendar.connection.expiresAt,
            emailAccountId: calendar.connection.emailAccountId,
          },
          logger,
          renewIfExpiresInMs: renewWindowMs,
        });
        successCount += 1;
      } catch (error) {
        errorCount += 1;
        logger.error("Failed to renew calendar watch", {
          calendarId: calendar.calendarId,
          error,
        });
      }
    }

    return NextResponse.json({
      success: true,
      processed: calendars.length,
      successful: successCount,
      failed: errorCount,
    });
  } catch (error) {
    logger.error("Critical error during calendar watch renewal", { error });
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
});
