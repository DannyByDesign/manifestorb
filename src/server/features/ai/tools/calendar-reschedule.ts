import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { CalendarEvent, CalendarEventUpdateInput } from "@/features/calendar/event-types";
import type { ToolResult } from "./types";

type RescheduleStrategy = "later" | "earlier" | "next_available" | "exact";

type CalendarRescheduleChanges = Record<string, unknown>;

type HandleCalendarRescheduleParams = {
  ids: string[];
  calendarId?: string;
  mode?: "single" | "series";
  changes: CalendarRescheduleChanges;
  start?: Date;
  end?: Date;
  timeZoneInput?: string;
  effectiveTimeZone: string;
  providers: {
    calendar: {
      getEvent(options: { eventId: string; calendarId?: string }): Promise<CalendarEvent | null>;
      findAvailableSlots(options: {
        durationMinutes: number;
        start?: Date;
        end?: Date;
      }): Promise<Array<{ start: Date; end: Date; score: number }>>;
      updateEvent(options: {
        calendarId?: string;
        eventId: string;
        input: CalendarEventUpdateInput;
      }): Promise<CalendarEvent>;
    };
  };
};

type RescheduleDirective = {
  strategy?: RescheduleStrategy;
  after?: Date;
  before?: Date;
  durationMinutes?: number;
};

function parseStrategy(value: unknown): RescheduleStrategy | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;

  if (normalized.includes("later")) return "later";
  if (normalized.includes("earlier")) return "earlier";
  if (normalized.includes("next") || normalized.includes("available")) return "next_available";
  if (normalized.includes("exact")) return "exact";

  return undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function parseDirective(changes: CalendarRescheduleChanges): RescheduleDirective {
  const directStrategy = parseStrategy(changes.rescheduleStrategy) ?? parseStrategy(changes.strategy);

  const rescheduleObject =
    typeof changes.reschedule === "object" && changes.reschedule !== null && !Array.isArray(changes.reschedule)
      ? (changes.reschedule as Record<string, unknown>)
      : undefined;

  const objectStrategy = rescheduleObject
    ? parseStrategy(rescheduleObject.strategy) ?? parseStrategy(rescheduleObject.mode)
    : undefined;

  const strategy = directStrategy ?? objectStrategy ?? parseStrategy(changes.reschedule);

  const after =
    parseDate(changes.after) ??
    parseDate(changes.startAfter) ??
    parseDate(rescheduleObject?.after) ??
    parseDate(rescheduleObject?.startAfter);

  const before =
    parseDate(changes.before) ??
    parseDate(changes.endBefore) ??
    parseDate(rescheduleObject?.before) ??
    parseDate(rescheduleObject?.endBefore);

  const durationMinutes =
    typeof changes.durationMinutes === "number"
      ? changes.durationMinutes
      : typeof rescheduleObject?.durationMinutes === "number"
        ? rescheduleObject.durationMinutes
        : undefined;

  return {
    strategy,
    after,
    before,
    durationMinutes,
  };
}

function hasCalendarUpdateFields(changes: CalendarRescheduleChanges): boolean {
  return [
    "title",
    "description",
    "location",
    "allDay",
    "isRecurring",
    "recurrenceRule",
  ].some((field) => field in changes);
}

function startOfLocalDay(dateUtc: Date, timeZone: string): Date {
  const local = toZonedTime(dateUtc, timeZone);
  local.setHours(0, 0, 0, 0);
  return fromZonedTime(local, timeZone);
}

function endOfLocalDay(dateUtc: Date, timeZone: string): Date {
  const local = toZonedTime(dateUtc, timeZone);
  local.setHours(23, 59, 59, 999);
  return fromZonedTime(local, timeZone);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function deriveTimeWindow(params: {
  strategy: RescheduleStrategy;
  event: CalendarEvent;
  overrideAfter?: Date;
  overrideBefore?: Date;
  timeZone: string;
}): { start: Date; end: Date } {
  const { strategy, event, overrideAfter, overrideBefore, timeZone } = params;

  if (overrideAfter && overrideBefore) {
    return { start: overrideAfter, end: overrideBefore };
  }

  if (strategy === "later") {
    return {
      start: overrideAfter ?? addMinutes(event.endTime, 1),
      end: overrideBefore ?? endOfLocalDay(event.startTime, timeZone),
    };
  }

  if (strategy === "earlier") {
    return {
      start: overrideAfter ?? startOfLocalDay(event.startTime, timeZone),
      end: overrideBefore ?? addMinutes(event.startTime, -1),
    };
  }

  return {
    start: overrideAfter ?? addMinutes(event.endTime, 1),
    end: overrideBefore ?? addMinutes(event.endTime, 14 * 24 * 60),
  };
}

function chooseSlot(params: {
  strategy: RescheduleStrategy;
  event: CalendarEvent;
  slots: Array<{ start: Date; end: Date; score: number }>;
}): { start: Date; end: Date } | null {
  const sorted = [...params.slots].sort((a, b) => a.start.getTime() - b.start.getTime());

  if (params.strategy === "earlier") {
    const candidates = sorted.filter((slot) => slot.end.getTime() <= params.event.startTime.getTime());
    const pick = candidates[candidates.length - 1];
    return pick ? { start: pick.start, end: pick.end } : null;
  }

  const lowerBound =
    params.strategy === "later" || params.strategy === "next_available"
      ? params.event.endTime.getTime()
      : Number.NEGATIVE_INFINITY;

  const pick = sorted.find((slot) => slot.start.getTime() >= lowerBound);
  return pick ? { start: pick.start, end: pick.end } : null;
}

function buildUpdateInput(params: {
  changes: CalendarRescheduleChanges;
  targetStart: Date;
  targetEnd: Date;
  mode?: "single" | "series";
  effectiveTimeZone: string;
  includeTimeZone: boolean;
}): CalendarEventUpdateInput {
  const { changes, targetStart, targetEnd, mode, effectiveTimeZone, includeTimeZone } = params;

  return {
    title: typeof changes.title === "string" ? changes.title : undefined,
    description: typeof changes.description === "string" ? changes.description : undefined,
    location: typeof changes.location === "string" ? changes.location : undefined,
    start: targetStart,
    end: targetEnd,
    allDay: typeof changes.allDay === "boolean" ? changes.allDay : undefined,
    isRecurring: typeof changes.isRecurring === "boolean" ? changes.isRecurring : undefined,
    recurrenceRule: typeof changes.recurrenceRule === "string" ? changes.recurrenceRule : undefined,
    mode,
    timeZone: includeTimeZone ? effectiveTimeZone : undefined,
  };
}

export async function handleCalendarReschedule(
  params: HandleCalendarRescheduleParams,
): Promise<ToolResult | null> {
  const directive = parseDirective(params.changes);
  const hasExplicitTimeChange = Boolean(params.start || params.end);

  if (!directive.strategy && !hasExplicitTimeChange) {
    return null;
  }

  const strategy: RescheduleStrategy = directive.strategy ?? "exact";
  const includeTimeZone = Boolean(params.timeZoneInput || hasExplicitTimeChange || strategy !== "exact");

  const updates: CalendarEvent[] = [];
  const moved: Array<{
    eventId: string;
    previousStart: string;
    previousEnd: string;
    newStart: string;
    newEnd: string;
    strategy: RescheduleStrategy;
  }> = [];

  for (const eventId of params.ids) {
    const currentEvent = await params.providers.calendar.getEvent({
      eventId,
      calendarId: params.calendarId,
    });

    if (!currentEvent) {
      return { success: false, error: `Calendar event not found: ${eventId}` };
    }

    const currentDurationMs = currentEvent.endTime.getTime() - currentEvent.startTime.getTime();
    if (currentDurationMs <= 0) {
      return { success: false, error: `Calendar event has invalid duration: ${eventId}` };
    }

    const requestedDurationMinutes = directive.durationMinutes;
    const durationMinutes =
      typeof requestedDurationMinutes === "number" && requestedDurationMinutes > 0
        ? Math.round(requestedDurationMinutes)
        : Math.max(1, Math.round(currentDurationMs / 60_000));

    let targetStart: Date | undefined;
    let targetEnd: Date | undefined;

    if (hasExplicitTimeChange) {
      targetStart = params.start ?? (params.end ? new Date(params.end.getTime() - durationMinutes * 60_000) : undefined);
      targetEnd = params.end ?? (params.start ? new Date(params.start.getTime() + durationMinutes * 60_000) : undefined);
    } else {
      const timeWindow = deriveTimeWindow({
        strategy,
        event: currentEvent,
        overrideAfter: directive.after,
        overrideBefore: directive.before,
        timeZone: params.effectiveTimeZone,
      });

      if (timeWindow.start.getTime() >= timeWindow.end.getTime()) {
        return {
          success: false,
          clarification: {
            kind: "missing_fields",
            prompt:
              "I can move it, but I need a wider time range. What time window should I search for the new slot?",
            missingFields: ["time window"],
          },
        };
      }

      const slots = await params.providers.calendar.findAvailableSlots({
        durationMinutes,
        start: timeWindow.start,
        end: timeWindow.end,
      });

      const slot = chooseSlot({
        strategy,
        event: currentEvent,
        slots,
      });

      if (!slot) {
        return {
          success: false,
          clarification: {
            kind: "missing_fields",
            prompt:
              "I couldn't find an open slot in that range. Want me to try a different window?",
            missingFields: ["time window"],
          },
        };
      }

      targetStart = slot.start;
      targetEnd = slot.end;
    }

    if (!targetStart || !targetEnd) {
      return {
        success: false,
        clarification: {
          kind: "missing_fields",
          prompt:
            "I can do that, but I still need the target time. What exact time should I move it to?",
          missingFields: ["target time"],
        },
      };
    }

    if (targetStart.getTime() >= targetEnd.getTime()) {
      return { success: false, error: "Calendar end time must be after start time." };
    }

    const updatedEvent = await params.providers.calendar.updateEvent({
      calendarId: params.calendarId,
      eventId,
      input: buildUpdateInput({
        changes: params.changes,
        targetStart,
        targetEnd,
        mode: params.mode,
        effectiveTimeZone: params.effectiveTimeZone,
        includeTimeZone,
      }),
    });

    updates.push(updatedEvent);
    moved.push({
      eventId,
      previousStart: currentEvent.startTime.toISOString(),
      previousEnd: currentEvent.endTime.toISOString(),
      newStart: targetStart.toISOString(),
      newEnd: targetEnd.toISOString(),
      strategy,
    });
  }

  return {
    success: true,
    data: {
      events: updates,
      moved,
      hasMetadataUpdates: hasCalendarUpdateFields(params.changes),
      strategy,
    },
  };
}
