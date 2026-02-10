import { NextResponse } from "next/server";
import { withError } from "@/server/lib/middleware";
import prisma from "@/server/db/client";
import { isValidInternalApiKey } from "@/server/lib/internal-api";
import { createScopedLogger } from "@/server/lib/logger";
import { syncGoogleCalendarChanges } from "@/features/calendar/sync/google";
import { syncMicrosoftCalendarChanges } from "@/features/calendar/sync/microsoft";
import { ensureGoogleCalendarWatch } from "@/features/calendar/sync/google";
import { ensureMicrosoftCalendarSubscription } from "@/features/calendar/sync/microsoft";
import { scheduleTasksForUser } from "@/features/calendar/scheduling/TaskSchedulingService";
import { runAdaptiveCalendarReplan } from "@/features/calendar/adaptive-replanner";

export const maxDuration = 300;

export const POST = withError("calendar/sync/reconcile", async (request) => {
  const logger = request.logger ?? createScopedLogger("calendar/sync/reconcile");

  if (!isValidInternalApiKey(request.headers, logger)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const calendars = await prisma.calendar.findMany({
    where: {
      isEnabled: true,
      connection: { isConnected: true },
    },
    include: {
      connection: {
        select: {
          provider: true,
          emailAccountId: true,
          accessToken: true,
          refreshToken: true,
          expiresAt: true,
          emailAccount: { select: { userId: true } },
        },
      },
    },
  });

  let changedCount = 0;

  for (const calendar of calendars) {
    const connection = calendar.connection;
    if (connection.provider === "microsoft") {
      await ensureMicrosoftCalendarSubscription({
        calendar: {
          id: calendar.id,
          calendarId: calendar.calendarId,
          microsoftSubscriptionId: calendar.microsoftSubscriptionId,
          microsoftSubscriptionExpiresAt: calendar.microsoftSubscriptionExpiresAt,
          microsoftDeltaToken: calendar.microsoftDeltaToken,
          microsoftClientState: calendar.microsoftClientState,
        },
        connection: {
          accessToken: connection.accessToken,
          refreshToken: connection.refreshToken,
          expiresAt: connection.expiresAt,
          emailAccountId: connection.emailAccountId,
        },
        logger,
      });
    } else {
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
          accessToken: connection.accessToken,
          refreshToken: connection.refreshToken,
          expiresAt: connection.expiresAt,
          emailAccountId: connection.emailAccountId,
        },
        logger,
      });
    }

    const syncResult =
      connection.provider === "microsoft"
        ? await syncMicrosoftCalendarChanges({
            calendar: {
              id: calendar.id,
              calendarId: calendar.calendarId,
              microsoftSubscriptionId: calendar.microsoftSubscriptionId,
              microsoftSubscriptionExpiresAt: calendar.microsoftSubscriptionExpiresAt,
              microsoftDeltaToken: calendar.microsoftDeltaToken,
              microsoftClientState: calendar.microsoftClientState,
            },
            connection: {
              accessToken: connection.accessToken,
              refreshToken: connection.refreshToken,
              expiresAt: connection.expiresAt,
              emailAccountId: connection.emailAccountId,
            },
            logger,
            userId: connection.emailAccount.userId,
          })
        : await syncGoogleCalendarChanges({
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
              accessToken: connection.accessToken,
              refreshToken: connection.refreshToken,
              expiresAt: connection.expiresAt,
              emailAccountId: connection.emailAccountId,
            },
            logger,
            userId: connection.emailAccount.userId,
          });

    if (syncResult.changed) {
      changedCount += 1;
      await scheduleTasksForUser({
        userId: connection.emailAccount.userId,
        emailAccountId: connection.emailAccountId,
        source: "reconcile",
      });
      await runAdaptiveCalendarReplan({
        userId: connection.emailAccount.userId,
        emailAccountId: connection.emailAccountId,
        source: "reconcile",
        changedEvents: (syncResult.canonical?.events ?? []) as Array<{
          id?: string;
          provider?: string;
          calendarId?: string;
          iCalUid?: string;
          title?: string;
          startTime?: string;
          endTime?: string;
        }>,
        logger,
      }).catch((error) => {
        logger.error("Adaptive calendar replan failed during reconcile", {
          error,
          calendarId: calendar.calendarId,
          provider: connection.provider,
        });
      });
    }
  }

  return NextResponse.json({ ok: true, changedCount });
});
