import { randomUUID } from "crypto";
import type { calendar_v3 } from "@googleapis/calendar";
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import { getCalendarClientWithRefresh } from "@/features/calendar/client";
import { startOfYear } from "@/features/calendar/utils";
import { env } from "@/env";
import {
  buildCalendarEventSnapshot,
  markCalendarEventShadowDeleted,
  upsertCalendarEventShadow,
} from "@/features/calendar/canonical-state";
import {
  markSearchIngestionCheckpointError,
  upsertSearchIngestionCheckpoint,
} from "@/server/features/search/index/repository";

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

const GOOGLE_NON_PUSH_CALENDAR_PATTERNS = [
  /#holiday@group\.v\.calendar\.google\.com$/i,
  /#contacts@group\.v\.calendar\.google\.com$/i,
];
const GOOGLE_NON_PUSH_REASON = "pushNotSupportedForRequestedResource";
const loggedWatchSkips = new Set<string>();

function isKnownGoogleNonPushCalendar(calendarId: string): boolean {
  return GOOGLE_NON_PUSH_CALENDAR_PATTERNS.some((pattern) =>
    pattern.test(calendarId),
  );
}

function getGoogleApiErrorReason(error: unknown): string | undefined {
  type GoogleApiError = {
    response?: {
      data?: {
        error?: {
          errors?: Array<{ reason?: unknown }>;
        };
      };
      status?: unknown;
    };
  };
  const reasons = (error as GoogleApiError)?.response?.data?.error?.errors;
  if (!Array.isArray(reasons) || reasons.length === 0) return undefined;
  const reason = reasons[0]?.reason;
  return typeof reason === "string" ? reason : undefined;
}

function getGoogleApiErrorDetails(error: unknown): {
  responseData?: unknown;
  responseStatus?: unknown;
} {
  type GoogleApiError = {
    response?: {
      data?: unknown;
      status?: unknown;
    };
  };
  const response = (error as GoogleApiError)?.response;
  return {
    responseData: response?.data,
    responseStatus: response?.status,
  };
}

function logWatchSkipOnce(
  logger: Logger,
  calendarId: string,
  reason: "known_non_push_calendar_id" | "push_not_supported",
) {
  const key = `${calendarId}:${reason}`;
  if (loggedWatchSkips.has(key)) return;
  loggedWatchSkips.add(key);
  logger.info("Skipping Google calendar watch for unsupported resource", {
    calendarId,
    reason,
  });
}

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
  if (isKnownGoogleNonPushCalendar(calendar.calendarId)) {
    logWatchSkipOnce(logger, calendar.calendarId, "known_non_push_calendar_id");
    return;
  }

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

  let response: calendar_v3.Schema$Channel | null = null;
  try {
    const watchResponse = await client.events.watch({
      calendarId: calendar.calendarId,
      requestBody: {
        id: channelId,
        type: "web_hook",
        address,
        token: channelToken,
      },
    });
    response = watchResponse.data ?? null;
  } catch (error) {
    const reason = getGoogleApiErrorReason(error);
    if (reason === GOOGLE_NON_PUSH_REASON) {
      logWatchSkipOnce(logger, calendar.calendarId, "push_not_supported");
      return;
    }

    // Don't fail the entire connect flow if watch setup fails; initial sync can
    // still proceed and the user can reconnect once the webhook URL/env is fixed.
    // Common causes:
    // - Webhook URL not HTTPS or invalid domain
    // - Calendar API not enabled / permissions
    const errorDetails = getGoogleApiErrorDetails(error);
    logger.warn("Failed to create Google calendar watch channel", {
      calendarId: calendar.calendarId,
      address,
      error,
      errorResponse: errorDetails.responseData,
      errorStatus: errorDetails.responseStatus,
    });
    return;
  }

  const resourceId = response?.resourceId ?? null;
  const expiration = response?.expiration
    ? new Date(Number(response.expiration))
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
  userId,
}: {
  calendar: CalendarSyncRecord;
  connection: CalendarConnectionTokens;
  logger: Logger;
  userId?: string;
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

    let canonicalProcessed = 0;
    let canonicalDeleted = 0;
    let canonicalRemapped = 0;
    const canonicalEvents: Array<Record<string, unknown>> = [];

    if (userId && items.length > 0) {
      for (const item of items) {
        const eventId = item.id ?? undefined;
        if (!eventId) continue;

        const isCancelled = item.status === "cancelled";
        if (isCancelled) {
          const deleted = await markCalendarEventShadowDeleted({
            userId,
            emailAccountId: connection.emailAccountId,
            provider: "google",
            calendarId: calendar.calendarId,
            externalEventId: eventId,
            iCalUid: item.iCalUID ?? undefined,
            source: "webhook",
          });
          if (deleted) canonicalDeleted += 1;
          continue;
        }

        const startValue = item.start?.dateTime ?? item.start?.date;
        const endValue = item.end?.dateTime ?? item.end?.date;
        if (!startValue || !endValue) continue;

        const startTime = new Date(startValue);
        const endTime = new Date(endValue);
        if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) continue;

        const event = {
          id: eventId,
          provider: "google" as const,
          calendarId: calendar.calendarId,
          iCalUid: item.iCalUID ?? undefined,
          seriesMasterId: item.recurringEventId ?? undefined,
          versionToken: item.etag ?? undefined,
          status: item.status ?? undefined,
          organizerEmail: item.organizer?.email ?? item.creator?.email ?? undefined,
          canEdit: item.guestsCanModify ?? true,
          canRespond: true,
          busyStatus: item.transparency === "transparent" ? "free" : "busy",
          isAllDay: Boolean(item.start?.date && !item.start?.dateTime),
          isDeleted: false,
          title: item.summary || "Untitled",
          description: item.description || undefined,
          location: item.location || undefined,
          eventUrl: item.htmlLink || undefined,
          videoConferenceLink: item.hangoutLink || undefined,
          startTime,
          endTime,
          attendees:
            item.attendees?.map((attendee) => ({
              email: attendee.email || "",
              name: attendee.displayName ?? undefined,
            })) || [],
        };

        const upserted = await upsertCalendarEventShadow({
          userId,
          emailAccountId: connection.emailAccountId,
          event,
          source: "webhook",
          metadata: {
            syncProvider: "google",
            webhookCalendarId: calendar.calendarId,
          },
        });
        if (!upserted) continue;
        canonicalProcessed += 1;
        if (upserted.remapped) canonicalRemapped += 1;
        canonicalEvents.push(buildCalendarEventSnapshot(event));
      }
    }

    if (nextSyncToken) {
      await prisma.calendar.update({
        where: { id: calendar.id },
        data: { googleSyncToken: nextSyncToken },
      });
      if (userId) {
        void upsertSearchIngestionCheckpoint({
          userId,
          emailAccountId: connection.emailAccountId,
          connector: "calendar",
          streamKey: `google_calendar:${calendar.calendarId}`,
          cursor: nextSyncToken,
          status: "active",
          errorMessage: null,
          lastSyncedAt: new Date(),
          state: {
            provider: "google",
            calendarId: calendar.calendarId,
          },
        }).catch((error) => {
          logger.warn("Failed to update calendar ingestion checkpoint", {
            calendarId: calendar.calendarId,
            error,
          });
        });
      }
    }

    if (items.length > 0 && userId) {
      import("@/server/features/calendar/scheduling/insights")
        .then(({ updateSchedulingInsights }) => updateSchedulingInsights(userId))
        .catch(() => {});
    }
    return {
      changed: items.length > 0,
      items,
      canonical: {
        processed: canonicalProcessed,
        deleted: canonicalDeleted,
        remapped: canonicalRemapped,
        events: canonicalEvents,
      },
    };
  } catch (error: unknown) {
    const status =
      (error as { code?: number; response?: { status?: number } })?.code ??
      (error as { code?: number; response?: { status?: number } })?.response?.status;
    if (status === 410) {
      logger.warn("Google sync token expired; resetting", {
        calendarId: calendar.calendarId,
      });

      const { items: retryItems, nextSyncToken } = await listEvents(null);
      await prisma.calendar.update({
        where: { id: calendar.id },
        data: { googleSyncToken: nextSyncToken ?? null },
      });
      if (userId) {
        void upsertSearchIngestionCheckpoint({
          userId,
          emailAccountId: connection.emailAccountId,
          connector: "calendar",
          streamKey: `google_calendar:${calendar.calendarId}`,
          cursor: nextSyncToken ?? null,
          status: "active",
          errorMessage: null,
          lastSyncedAt: new Date(),
          state: {
            provider: "google",
            calendarId: calendar.calendarId,
            resetOn410: true,
          },
        }).catch((error) => {
          logger.warn("Failed to update calendar ingestion checkpoint after token reset", {
            calendarId: calendar.calendarId,
            error,
          });
        });
      }
      if (retryItems.length > 0 && userId) {
        import("@/server/features/calendar/scheduling/insights")
          .then(({ updateSchedulingInsights }) => updateSchedulingInsights(userId))
          .catch(() => {});
      }
      return {
        changed: retryItems.length > 0,
        items: retryItems,
        canonical: {
          processed: 0,
          deleted: 0,
          remapped: 0,
          events: [],
        },
      };
    }

    if (userId) {
      void markSearchIngestionCheckpointError({
        userId,
        connector: "calendar",
        streamKey: `google_calendar:${calendar.calendarId}`,
        errorMessage: error instanceof Error ? error.message : "calendar_sync_failed",
      }).catch((checkpointError) => {
        logger.warn("Failed to mark calendar ingestion checkpoint error", {
          calendarId: calendar.calendarId,
          error: checkpointError,
        });
      });
    }

    throw error;
  }
}
