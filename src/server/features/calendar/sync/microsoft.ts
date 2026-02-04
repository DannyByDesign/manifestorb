import { randomUUID } from "crypto";
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import { env } from "@/env";
import { getCalendarClientWithRefresh } from "@/server/lib/outlook/calendar-client";
import { fetchAllEvents } from "@/server/integrations/microsoft/calendar-sync";

type CalendarConnectionTokens = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  emailAccountId: string;
};

type CalendarSyncRecord = {
  id: string;
  calendarId: string;
  microsoftSubscriptionId: string | null;
  microsoftSubscriptionExpiresAt: Date | null;
  microsoftDeltaToken: string | null;
  microsoftClientState: string | null;
};

async function getOutlookClient(
  connection: CalendarConnectionTokens,
  logger: Logger,
) {
  return getCalendarClientWithRefresh({
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.expiresAt?.getTime() ?? null,
    emailAccountId: connection.emailAccountId,
    logger,
  });
}

export async function ensureMicrosoftCalendarSubscription({
  calendar,
  connection,
  logger,
}: {
  calendar: CalendarSyncRecord;
  connection: CalendarConnectionTokens;
  logger: Logger;
}) {
  if (!env.NEXT_PUBLIC_BASE_URL) {
    logger.warn("Missing NEXT_PUBLIC_BASE_URL; skipping Outlook subscription");
    return;
  }

  const client = await getOutlookClient(connection, logger);
  const now = Date.now();
  const renewalTarget = new Date(now + 1000 * 60 * 60 * 24 * 2); // 48 hours

  if (
    calendar.microsoftSubscriptionId &&
    calendar.microsoftSubscriptionExpiresAt &&
    calendar.microsoftSubscriptionExpiresAt.getTime() > now + 10 * 60 * 1000
  ) {
    return;
  }

  const notificationUrl = new URL(
    "/api/outlook/calendar/webhook",
    env.NEXT_PUBLIC_BASE_URL,
  ).toString();

  if (calendar.microsoftSubscriptionId) {
    try {
      const renewed = await client
        .api(`/subscriptions/${calendar.microsoftSubscriptionId}`)
        .patch({ expirationDateTime: renewalTarget.toISOString() });

      await prisma.calendar.update({
        where: { id: calendar.id },
        data: {
          microsoftSubscriptionExpiresAt: new Date(renewed.expirationDateTime),
        },
      });
      return;
    } catch (error) {
      logger.warn("Failed to renew Outlook subscription, recreating", {
        calendarId: calendar.calendarId,
        error,
      });
    }
  }

  const clientState = randomUUID();
  const subscription = await client.api("/subscriptions").post({
    changeType: "created,updated,deleted",
    notificationUrl,
    resource: `/me/calendars/${calendar.calendarId}/events`,
    expirationDateTime: renewalTarget.toISOString(),
    clientState,
  });

  await prisma.calendar.update({
    where: { id: calendar.id },
    data: {
      microsoftSubscriptionId: subscription.id,
      microsoftSubscriptionExpiresAt: new Date(subscription.expirationDateTime),
      microsoftClientState: clientState,
    },
  });
}

export async function syncMicrosoftCalendarChanges({
  calendar,
  connection,
  logger,
}: {
  calendar: CalendarSyncRecord;
  connection: CalendarConnectionTokens;
  logger: Logger;
}) {
  const client = await getOutlookClient(connection, logger);

  const { events, deletedEventIds, nextSyncToken } = await fetchAllEvents({
    client,
    calendarId: calendar.calendarId,
    syncToken: calendar.microsoftDeltaToken,
    logger,
  });

  if (nextSyncToken) {
    await prisma.calendar.update({
      where: { id: calendar.id },
      data: { microsoftDeltaToken: nextSyncToken },
    });
  }

  return { changed: events.length > 0 || deletedEventIds.length > 0 };
}
