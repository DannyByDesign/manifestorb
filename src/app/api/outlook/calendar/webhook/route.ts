import { after, NextResponse } from "next/server";
import { withError } from "@/server/lib/middleware";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { syncMicrosoftCalendarChanges } from "@/features/calendar/sync/microsoft";
import { scheduleTasksForUser } from "@/features/calendar/scheduling/TaskSchedulingService";

export const maxDuration = 300;

export const POST = withError("outlook/calendar/webhook", async (request) => {
  const logger = request.logger ?? createScopedLogger("outlook/calendar/webhook");
  const validationToken = request.nextUrl.searchParams.get("validationToken");

  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const body = await request.json().catch(() => null);
  const notifications: Array<{
    subscriptionId?: string;
    clientState?: string;
  }> = body?.value || [];

  if (!notifications.length) {
    return NextResponse.json({ ok: true });
  }

  const subscriptionIds = Array.from(
    new Set(
      notifications
        .map((item) => item.subscriptionId)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const calendars = await prisma.calendar.findMany({
    where: { microsoftSubscriptionId: { in: subscriptionIds } },
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

  const calendarBySubscription = new Map(
    calendars.map((calendar) => [calendar.microsoftSubscriptionId, calendar]),
  );

  const validCalendars = notifications
    .map((notification) => {
      const subscriptionId = notification.subscriptionId ?? null;
      const calendar = calendarBySubscription.get(subscriptionId);
      if (!calendar) return null;
      if (
        calendar.microsoftClientState &&
        notification.clientState &&
        calendar.microsoftClientState !== notification.clientState
      ) {
        logger.warn("Outlook calendar webhook clientState mismatch", {
          calendarId: calendar.id,
        });
        return null;
      }
      return calendar;
    })
    .filter((value): value is (typeof calendars)[number] => Boolean(value));

  after(async () => {
    const uniqueCalendars = Array.from(
      new Map(validCalendars.map((c) => [c.id, c])).values(),
    );

    for (const calendar of uniqueCalendars) {
      const syncResult = await syncMicrosoftCalendarChanges({
        calendar: {
          id: calendar.id,
          calendarId: calendar.calendarId,
          microsoftSubscriptionId: calendar.microsoftSubscriptionId,
          microsoftSubscriptionExpiresAt: calendar.microsoftSubscriptionExpiresAt,
          microsoftDeltaToken: calendar.microsoftDeltaToken,
          microsoftClientState: calendar.microsoftClientState,
        },
        connection: {
          accessToken: calendar.connection.accessToken,
          refreshToken: calendar.connection.refreshToken,
          expiresAt: calendar.connection.expiresAt,
          emailAccountId: calendar.connection.emailAccountId,
        },
        logger,
      });

      if (syncResult.changed) {
        await scheduleTasksForUser({
          userId: calendar.connection.emailAccount.userId,
          emailAccountId: calendar.connection.emailAccountId,
          source: "webhook",
        });
      }
    }
  });

  return NextResponse.json({ ok: true });
});
