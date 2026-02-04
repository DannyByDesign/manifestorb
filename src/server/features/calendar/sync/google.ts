import { randomUUID } from "crypto";
import type { calendar_v3 } from "@googleapis/calendar";
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import { getCalendarClientWithRefresh } from "@/features/calendar/client";
import { startOfYear } from "@/features/calendar/utils";
import { env } from "@/env";

type CalendarConnectionTokens = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  emailAccountId: string;
};

type CalendarSyncRecord = {
  id: string;
  calendarId: string;
  googleSyncToken: string | null;
  googleChannelId: string | null;
  googleResourceId: string | null;
  googleChannelToken: string | null;
  googleChannelExpiresAt: Date | null;
};

async function getGoogleClient(
  connection: CalendarConnectionTokens,
  logger: Logger,
): Promise<calendar_v3.Calendar> {
  return getCalendarClientWithRefresh({
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.expiresAt?.getTime() ?? null,
    emailAccountId: connection.emailAccountId,
    logger,
  });
}

export async function ensureGoogleCalendarWatch({
  calendar,
  connection,
  logger,
  renewIfExpiresInMs,
}: {
  calendar: CalendarSyncRecord;
  connection: CalendarConnectionTokens;
  logger: Logger;
  renewIfExpiresInMs?: number;
}) {
  if (!env.NEXT_PUBLIC_BASE_URL) {
    logger.warn("Missing NEXT_PUBLIC_BASE_URL; skipping Google calendar watch");
    return;
  }

  const now = Date.now();
  const minRenewMs = renewIfExpiresInMs ?? 5 * 60 * 1000;
  if (
    calendar.googleChannelId &&
    calendar.googleResourceId &&
    calendar.googleChannelExpiresAt &&
    calendar.googleChannelExpiresAt.getTime() > now + minRenewMs
  ) {
    return;
  }

  const client = await getGoogleClient(connection, logger);

  if (calendar.googleChannelId && calendar.googleResourceId) {
    try {
      await client.channels.stop({
        requestBody: {
          id: calendar.googleChannelId,
          resourceId: calendar.googleResourceId,
        },
      });
    } catch (error) {
      logger.warn("Failed to stop old Google calendar channel", {
        calendarId: calendar.calendarId,
        error,
      });
    }
  }

  const channelId = randomUUID();
  const channelToken = randomUUID();
  const address = new URL(
    "/api/google/calendar/webhook",
    env.NEXT_PUBLIC_BASE_URL,
  ).toString();

  const response = await client.events.watch({
    calendarId: calendar.calendarId,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address,
      token: channelToken,
    },
  });

  const resourceId = response.data.resourceId ?? null;
  const expiration = response.data.expiration
    ? new Date(Number(response.data.expiration))
    : null;

  await prisma.calendar.update({
    where: { id: calendar.id },
    data: {
      googleChannelId: channelId,
      googleResourceId: resourceId,
      googleChannelToken: channelToken,
      googleChannelExpiresAt: expiration,
    },
  });
}

export async function syncGoogleCalendarChanges({
  calendar,
  connection,
  logger,
}: {
  calendar: CalendarSyncRecord;
  connection: CalendarConnectionTokens;
  logger: Logger;
}) {
  const client = await getGoogleClient(connection, logger);
  const start = startOfYear(new Date().getUTCFullYear());
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);

  const listEvents = async (syncToken?: string | null) => {
    const items: calendar_v3.Schema$Event[] = [];
    let nextPageToken: string | undefined;
    let nextSyncToken: string | undefined;

    do {
      const response = await client.events.list({
        calendarId: calendar.calendarId,
        syncToken: syncToken ?? undefined,
        timeMin: syncToken ? undefined : start.toISOString(),
        timeMax: syncToken ? undefined : end.toISOString(),
        showDeleted: true,
        singleEvents: false,
        pageToken: nextPageToken,
        maxResults: 2500,
      });

      items.push(...(response.data.items || []));
      nextPageToken = response.data.nextPageToken ?? undefined;
      nextSyncToken = response.data.nextSyncToken ?? nextSyncToken;
    } while (nextPageToken);

    return { items, nextSyncToken };
  };

  try {
    const { items, nextSyncToken } = await listEvents(
      calendar.googleSyncToken,
    );

    if (nextSyncToken) {
      await prisma.calendar.update({
        where: { id: calendar.id },
        data: { googleSyncToken: nextSyncToken },
      });
    }

    return { changed: items.length > 0, items };
  } catch (error: any) {
    const status = error?.code || error?.response?.status;
    if (status === 410) {
      logger.warn("Google sync token expired; resetting", {
        calendarId: calendar.calendarId,
      });

      const { items, nextSyncToken } = await listEvents(null);
      await prisma.calendar.update({
        where: { id: calendar.id },
        data: { googleSyncToken: nextSyncToken ?? null },
      });
      return { changed: items.length > 0, items };
    }

    throw error;
  }
}
