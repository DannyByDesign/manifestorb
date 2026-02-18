import {
  findCalendarEventShadowByIdentity,
  resolveCalendarEventPolicy,
  upsertCalendarEventShadow,
} from "@/features/calendar/canonical-state";
import type { CalendarEvent } from "@/features/calendar/event-types";

function overlaps(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start < b.end && b.start < a.end;
}

export type CalendarMutationType = "create" | "update" | "reschedule";

export type CalendarSafetyResult =
  | {
      ok: true;
      targetEvent?: CalendarEvent;
      targetPolicy?: {
        reschedulePolicy: "FIXED" | "FLEXIBLE" | "APPROVAL_REQUIRED";
        isProtected: boolean;
      };
      overlaps: Array<{ id: string; title?: string }>;
    }
  | {
      ok: false;
      error: string;
      clarification?: {
        kind: "missing_fields" | "permissions" | "other";
        prompt: string;
        missingFields?: string[];
      };
    };

export async function validateCalendarMutationSafety(params: {
  userId: string;
  emailAccountId: string;
  mutation: CalendarMutationType;
  providers: {
    calendar: {
      getEvent(options: { eventId: string; calendarId?: string }): Promise<CalendarEvent | null>;
      searchEvents(
        query: string,
        range: { start: Date; end: Date },
        attendeeEmail?: string,
      ): Promise<CalendarEvent[]>;
    };
  };
  targetEventId?: string;
  calendarId?: string;
  proposedStart: Date;
  proposedEnd: Date;
  mode?: "single" | "series";
}): Promise<CalendarSafetyResult> {
  if (params.proposedStart.getTime() >= params.proposedEnd.getTime()) {
    return {
      ok: false,
      error: "Calendar end time must be after start time.",
    };
  }

  let targetEvent: CalendarEvent | undefined;
  let targetPolicy:
    | {
        reschedulePolicy: "FIXED" | "FLEXIBLE" | "APPROVAL_REQUIRED";
        isProtected: boolean;
      }
    | undefined;

  if (params.targetEventId) {
    const found = await params.providers.calendar.getEvent({
      eventId: params.targetEventId,
      calendarId: params.calendarId,
    });
    if (!found) {
      return {
        ok: false,
        error: `Calendar event not found: ${params.targetEventId}`,
      };
    }
    targetEvent = found;

    if (targetEvent.canEdit === false) {
      return {
        ok: false,
        error: "This event can't be edited from your account.",
        clarification: {
          kind: "permissions",
          prompt: "calendar_event_edit_permission_denied",
        },
      };
    }

    const upserted = await upsertCalendarEventShadow({
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      event: targetEvent,
      source: "ai",
      metadata: {
        safetyGate: true,
      },
    });

    const policy = await resolveCalendarEventPolicy({
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      shadowEventId: upserted?.shadowId,
      eventHint: {
        provider: targetEvent.provider,
        calendarId: targetEvent.calendarId,
        iCalUid: targetEvent.iCalUid,
        title: targetEvent.title,
      },
    });

    targetPolicy = {
      reschedulePolicy: policy.reschedulePolicy,
      isProtected: policy.isProtected,
    };

    const isTimeMutation =
      params.mutation === "reschedule" ||
      params.proposedStart.getTime() !== targetEvent.startTime.getTime() ||
      params.proposedEnd.getTime() !== targetEvent.endTime.getTime();

    if (isTimeMutation && policy.reschedulePolicy === "FIXED") {
      return {
        ok: false,
        error: "That event is currently marked as fixed and cannot be moved automatically.",
        clarification: {
          kind: "other",
          prompt: "calendar_event_fixed_override_required",
        },
      };
    }

    if (isTimeMutation && targetEvent.seriesMasterId && !params.mode) {
      return {
        ok: false,
        error: "Recurring event scope required.",
        clarification: {
          kind: "missing_fields",
          prompt: "calendar_recurring_scope_required",
          missingFields: ["changes.mode"],
        },
      };
    }
  }

  const nearbyEvents = await params.providers.calendar.searchEvents("", {
    start: new Date(params.proposedStart.getTime() - 60_000),
    end: new Date(params.proposedEnd.getTime() + 60_000),
  });

  const overlapsFound = nearbyEvents.filter((event) => {
    if (targetEvent && event.id === targetEvent.id) return false;
    if (
      targetEvent &&
      event.iCalUid &&
      targetEvent.iCalUid &&
      event.iCalUid === targetEvent.iCalUid &&
      params.mode === "series"
    ) {
      return false;
    }
    return overlaps(
      { start: event.startTime, end: event.endTime },
      { start: params.proposedStart, end: params.proposedEnd },
    );
  });

  for (const overlapEvent of overlapsFound) {
    const overlapShadow = await findCalendarEventShadowByIdentity({
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      provider: overlapEvent.provider,
      calendarId: overlapEvent.calendarId,
      externalEventId: overlapEvent.id,
      iCalUid: overlapEvent.iCalUid,
    });

    const overlapPolicy = await resolveCalendarEventPolicy({
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      shadowEventId: overlapShadow?.id,
      eventHint: {
        provider: overlapEvent.provider,
        calendarId: overlapEvent.calendarId,
        iCalUid: overlapEvent.iCalUid,
        title: overlapEvent.title,
      },
    });

    if (overlapPolicy.isProtected || overlapPolicy.reschedulePolicy === "FIXED") {
      return {
        ok: false,
        error: `That time overlaps protected calendar time${overlapEvent.title ? ` (${overlapEvent.title})` : ""}.`,
        clarification: {
          kind: "other",
          prompt: "calendar_protected_time_conflict",
        },
      };
    }
  }

  return {
    ok: true,
    targetEvent,
    targetPolicy,
    overlaps: overlapsFound.map((event) => ({ id: event.id, title: event.title })),
  };
}
