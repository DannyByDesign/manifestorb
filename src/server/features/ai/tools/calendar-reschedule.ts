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
  validateCandidate?: (params: {
    eventId: string;
    currentEvent: CalendarEvent;
    targetStart: Date;
    targetEnd: Date;
    strategy: RescheduleStrategy;
  }) => Promise<{
    ok: boolean;
    error?: string;
    clarification?: ToolResult["clarification"];
  }>;
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

function chooseSlot(params: {
  strategy: RescheduleStrategy;
  slots: Array<{ start: Date; end: Date; score: number }>;
}): { start: Date; end: Date } | null {
  const sorted = [...params.slots].sort((a, b) => {
    const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
    if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
    if (params.strategy === "earlier") {
      return b.start.getTime() - a.start.getTime();
    }
    return a.start.getTime() - b.start.getTime();
  });
  const pick = sorted[0];
  return pick ? { start: pick.start, end: pick.end } : null;
}

function startOfLocalWeek(dateUtc: Date, timeZone: string): Date {
  const local = toZonedTime(dateUtc, timeZone);
  const day = local.getDay();
  local.setDate(local.getDate() - day);
  local.setHours(0, 0, 0, 0);
  return fromZonedTime(local, timeZone);
}

function endOfLocalWeek(dateUtc: Date, timeZone: string): Date {
  const local = toZonedTime(dateUtc, timeZone);
  const day = local.getDay();
  local.setDate(local.getDate() + (6 - day));
  local.setHours(23, 59, 59, 999);
  return fromZonedTime(local, timeZone);
}

function deriveTimeWindows(params: {
  strategy: RescheduleStrategy;
  event: CalendarEvent;
  overrideAfter?: Date;
  overrideBefore?: Date;
  timeZone: string;
}): Array<{ start: Date; end: Date; label: string }> {
  const { strategy, event, overrideAfter, overrideBefore, timeZone } = params;

  if (overrideAfter && overrideBefore) {
    return [{ start: overrideAfter, end: overrideBefore, label: "requested_window" }];
  }

  if (strategy === "later") {
    const sameDayStart = overrideAfter ?? addMinutes(event.endTime, 1);
    const sameDayEnd = overrideBefore ?? endOfLocalDay(event.startTime, timeZone);
    const weekEnd = overrideBefore ?? endOfLocalWeek(event.startTime, timeZone);
    return [
      { start: sameDayStart, end: sameDayEnd, label: "same_day_later" },
      { start: sameDayStart, end: weekEnd, label: "same_week_later" },
      {
        start: sameDayStart,
        end: addMinutes(event.endTime, 14 * 24 * 60),
        label: "next_two_weeks_later",
      },
    ];
  }

  if (strategy === "earlier") {
    const sameDayStart = overrideAfter ?? startOfLocalDay(event.startTime, timeZone);
    const sameDayEnd = overrideBefore ?? addMinutes(event.startTime, -1);
    const weekStart = overrideAfter ?? startOfLocalWeek(event.startTime, timeZone);
    return [
      { start: sameDayStart, end: sameDayEnd, label: "same_day_earlier" },
      { start: weekStart, end: sameDayEnd, label: "same_week_earlier" },
      {
        start: addMinutes(event.startTime, -14 * 24 * 60),
        end: sameDayEnd,
        label: "previous_two_weeks_earlier",
      },
    ];
  }

  const defaultStart = overrideAfter ?? addMinutes(event.endTime, 1);
  return [
    { start: defaultStart, end: overrideBefore ?? addMinutes(event.endTime, 7 * 24 * 60), label: "next_week" },
    { start: defaultStart, end: overrideBefore ?? addMinutes(event.endTime, 14 * 24 * 60), label: "next_two_weeks" },
  ];
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
      const windows = deriveTimeWindows({
        strategy,
        event: currentEvent,
        overrideAfter: directive.after,
        overrideBefore: directive.before,
        timeZone: params.effectiveTimeZone,
      });

      let foundSlot: { start: Date; end: Date } | null = null;

      for (const window of windows) {
        if (window.start.getTime() >= window.end.getTime()) {
          continue;
        }

        const slots = await params.providers.calendar.findAvailableSlots({
          durationMinutes,
          start: window.start,
          end: window.end,
        });

        const candidate = chooseSlot({ strategy, slots });
        if (!candidate) continue;

        if (params.validateCandidate) {
          const validation = await params.validateCandidate({
            eventId,
            currentEvent,
            targetStart: candidate.start,
            targetEnd: candidate.end,
            strategy,
          });
          if (!validation.ok) continue;
        }

        foundSlot = candidate;
        break;
      }

      if (!foundSlot) {
        return {
          success: false,
          clarification: {
            kind: "missing_fields",
            prompt:
              "I couldn't find a safe slot in that range. I can try a wider window or a shorter duration. Which do you prefer?",
            missingFields: ["time window or duration"],
          },
        };
      }

      targetStart = foundSlot.start;
      targetEnd = foundSlot.end;
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

    if (params.validateCandidate) {
      const validation = await params.validateCandidate({
        eventId,
        currentEvent,
        targetStart,
        targetEnd,
        strategy,
      });
      if (!validation.ok) {
        return {
          success: false,
          ...(validation.error ? { error: validation.error } : {}),
          ...(validation.clarification ? { clarification: validation.clarification } : {}),
        };
      }
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
