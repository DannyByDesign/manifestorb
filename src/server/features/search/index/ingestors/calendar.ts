import type { CalendarEvent } from "@/features/calendar/event-types";
import { SearchIndexQueue } from "@/server/features/search/index/queue";
import type { Logger } from "@/server/lib/logger";
import type { SearchDocumentIdentity, SearchIndexedDocument } from "@/server/features/search/index/types";

function computeFreshnessScore(iso: string | undefined): number {
  if (!iso) return 0;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 0;
  const days = Math.max(0, (Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (days <= 1) return 1;
  if (days <= 7) return 0.85;
  if (days <= 30) return 0.6;
  if (days <= 90) return 0.35;
  return 0.2;
}

export async function enqueueCalendarEventDocumentForIndexing(params: {
  userId: string;
  emailAccountId: string;
  event: CalendarEvent;
  logger: Logger;
}) {
  const startIso = params.event.startTime?.toISOString();
  const endIso = params.event.endTime?.toISOString();
  const attendees = (params.event.attendees ?? []).map((attendee) => attendee.email).filter(Boolean);
  const text = [
    params.event.title,
    params.event.description,
    params.event.location,
    attendees.join(" "),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");

  const payload: SearchIndexedDocument = {
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    connector: "calendar",
    sourceType: "event",
    sourceId: params.event.id,
    sourceParentId: params.event.seriesMasterId,
    title: params.event.title || "(Untitled Event)",
    snippet: params.event.description || params.event.location || "",
    bodyText: text,
    authorIdentity: params.event.organizerEmail ?? undefined,
    startAt: startIso,
    endAt: endIso,
    occurredAt: startIso,
    updatedSourceAt: startIso,
    freshnessScore: computeFreshnessScore(startIso),
    authorityScore: 0.45,
    metadata: {
      provider: params.event.provider,
      calendarId: params.event.calendarId,
      iCalUid: params.event.iCalUid ?? null,
      status: params.event.status ?? null,
      location: params.event.location ?? null,
      allDay: params.event.isAllDay ?? false,
      canEdit: params.event.canEdit ?? true,
      canRespond: params.event.canRespond ?? true,
      attendees,
    },
  };

  try {
    await SearchIndexQueue.enqueueUpsert(payload);
  } catch (error) {
    params.logger.warn("Failed to enqueue calendar event for indexing", {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      eventId: params.event.id,
      error,
    });
  }
}

export async function enqueueCalendarEventDeleteForIndexing(params: {
  identity: SearchDocumentIdentity;
  logger: Logger;
}) {
  try {
    await SearchIndexQueue.enqueueDelete(params.identity);
  } catch (error) {
    params.logger.warn("Failed to enqueue calendar event deletion for indexing", {
      identity: params.identity,
      error,
    });
  }
}
