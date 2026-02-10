import { after, NextResponse } from "next/server";
import { withError } from "@/server/lib/middleware";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { syncGoogleCalendarChanges } from "@/features/calendar/sync/google";
import { scheduleTasksForUser } from "@/features/calendar/scheduling/TaskSchedulingService";
import { createInAppNotification } from "@/features/notifications/create";
import { wasRecentCalendarAction } from "@/features/calendar/action-log";
import { isDefined } from "@/server/lib/types";
import { runAdaptiveCalendarReplan } from "@/features/calendar/adaptive-replanner";

export const maxDuration = 300;

export const POST = withError("google/calendar/webhook", async (request) => {
  const logger = request.logger ?? createScopedLogger("google/calendar/webhook");
  const channelId = request.headers.get("x-goog-channel-id") || "";
  const resourceId = request.headers.get("x-goog-resource-id") || "";
  const channelToken = request.headers.get("x-goog-channel-token") || "";
  const resourceState = request.headers.get("x-goog-resource-state") || "";

  if (!channelId || !resourceId) {
    logger.warn("Missing Google calendar webhook headers");
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const calendar = await prisma.calendar.findFirst({
    where: {
      googleChannelId: channelId,
      googleResourceId: resourceId,
    },
    include: {
      connection: {
        select: {
          emailAccountId: true,
          accessToken: true,
          refreshToken: true,
          expiresAt: true,
          emailAccount: { select: { userId: true } },
        },
      },
    },
  });

  if (!calendar) {
    logger.warn("Google calendar webhook: calendar not found", {
      channelId,
      resourceId,
    });
    return NextResponse.json({ ok: true });
  }

  if (calendar.googleChannelToken && channelToken !== calendar.googleChannelToken) {
    logger.warn("Google calendar webhook token mismatch", {
      calendarId: calendar.id,
    });
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  logger.info("Received Google calendar webhook", {
    calendarId: calendar.calendarId,
    resourceState,
  });

  after(async () => {
    const syncResult = await syncGoogleCalendarChanges({
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
      userId: calendar.connection.emailAccount.userId,
    });

    if (syncResult.changed) {
      await scheduleTasksForUser({
        userId: calendar.connection.emailAccount.userId,
        emailAccountId: calendar.connection.emailAccountId,
        source: "webhook",
      });

      await runAdaptiveCalendarReplan({
        userId: calendar.connection.emailAccount.userId,
        emailAccountId: calendar.connection.emailAccountId,
        source: "webhook",
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
        logger.error("Adaptive calendar replan failed after Google webhook", {
          error,
          calendarId: calendar.calendarId,
        });
      });

      const emailAccount = await prisma.emailAccount.findUnique({
        where: { id: calendar.connection.emailAccountId },
        select: { email: true },
      });

      const externalEvents: {
        id?: string | null;
        summary?: string | null;
        updated?: string | null;
        organizer?: { email?: string | null; self?: boolean | null } | null;
        creator?: { email?: string | null; self?: boolean | null } | null;
        start?: unknown;
        end?: unknown;
        status?: string | null;
      }[] = [];

      for (const event of syncResult.items ?? []) {
        if (!event?.id) continue;
        if (event.status === "cancelled") continue;
        if (!event.start || !event.end) continue;

        const recentlyInternal = await wasRecentCalendarAction({
          userId: calendar.connection.emailAccount.userId,
          eventId: event.id,
        });
        if (recentlyInternal) continue;

        const isSelfOrganizer =
          event.organizer?.self === true ||
          event.creator?.self === true ||
          (emailAccount?.email &&
            (event.organizer?.email === emailAccount.email ||
              event.creator?.email === emailAccount.email));
        if (isSelfOrganizer) continue;

        externalEvents.push(event);
      }

      if (externalEvents.length > 0) {
        const primary = externalEvents[0];
        const title = "Schedule updated";
        const body =
          externalEvents.length === 1
            ? `${primary.summary || "A meeting"} moved. I adjusted your schedule to fit it.`
            : `${externalEvents.length} meetings changed. I adjusted your schedule to fit them.`;

        const eventIds = externalEvents
          .map((event) => event.id)
          .filter(isDefined);

        await createInAppNotification({
          userId: calendar.connection.emailAccount.userId,
          title,
          body,
          type: "calendar",
          metadata: {
            eventIds,
          },
          dedupeKey: `calendar-external-change:${primary.id ?? "unknown"}:${primary.updated ?? Date.now()}`,
        });
      }
    }
  });

  return NextResponse.json({ ok: true });
});
