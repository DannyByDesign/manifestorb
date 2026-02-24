import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import prisma from "@/server/db/client";
import type { CalendarEventUpdateInput } from "@/features/calendar/event-types";
import { capabilityFailureResult } from "@/server/features/ai/tools/runtime/capabilities/errors";
import {
  resolveCalendarTimeRange,
  resolveCalendarTimeZoneForRequest,
  resolveDefaultCalendarTimeZone,
} from "@/server/features/ai/tools/calendar-time";
import {
  formatDateTimeForUser,
  parseDateBoundInTimeZone,
} from "@/server/features/ai/tools/timezone";
import { normalizeTemporalRange } from "@/server/features/ai/runtime/temporal/normalize";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findCalendarAvailability,
  getCalendarEvent,
  updateCalendarEvent,
} from "@/server/features/ai/tools/calendar/primitives";
import { runMutationWithIdempotency } from "@/server/features/ai/tools/runtime/capabilities/mutation-idempotency";
import {
  ensureCalendarSelectionInvariant,
  isLikelyNoisyCalendar,
} from "@/server/features/calendar/selection-invariant";

export interface CalendarCapabilities {
  findAvailability(filter: Record<string, unknown>): Promise<ToolResult>;
  listEvents(filter: Record<string, unknown>): Promise<ToolResult>;
  detectConflicts(filter: Record<string, unknown>): Promise<ToolResult>;
  searchEventsByAttendee(filter: Record<string, unknown>): Promise<ToolResult>;
  getEvent(input: { eventId: string; calendarId?: string }): Promise<ToolResult>;
  listCalendars(): Promise<ToolResult>;
  setEnabledCalendars(input: Record<string, unknown>): Promise<ToolResult>;
  setSelectedCalendars(input: Record<string, unknown>): Promise<ToolResult>;
  createEvent(data: Record<string, unknown>): Promise<ToolResult>;
  updateEvent(input: {
    eventId: string;
    calendarId?: string;
    changes: Record<string, unknown>;
  }): Promise<ToolResult>;
  deleteEvent(input: {
    eventId: string;
    calendarId?: string;
    mode?: "single" | "series";
    instanceId?: string;
    originalStartTime?: string;
  }): Promise<ToolResult>;
  manageAttendees(input: {
    eventId: string;
    calendarId?: string;
    attendees: string[];
    mode?: "single" | "series";
  }): Promise<ToolResult>;
  updateRecurringMode(input: {
    eventId: string;
    calendarId?: string;
    mode: "single" | "series";
    changes?: Record<string, unknown>;
  }): Promise<ToolResult>;
  rescheduleEvent(input: {
    eventIds?: string[];
    filter?: Record<string, unknown>;
    changes?: Record<string, unknown>;
  }): Promise<ToolResult>;
  setWorkingHours(changes: Record<string, unknown>): Promise<ToolResult>;
  setWorkingLocation(changes: Record<string, unknown>): Promise<ToolResult>;
  setOutOfOffice(data: Record<string, unknown>): Promise<ToolResult>;
  createFocusBlock(data: Record<string, unknown>): Promise<ToolResult>;
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function calendarFailure(error: unknown, message: string): ToolResult {
  return capabilityFailureResult(error, message, { resource: "calendar" });
}

type ConflictEvent = {
  id: string;
  calendarId: string | null;
  title: string | null;
  start: string;
  end: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  snippet: string | null;
};

type ConflictGroup = {
  start: string;
  end: string;
  startLocal: string;
  endLocal: string;
  events: Array<{
    id: string;
    calendarId: string | null;
    title: string | null;
    start: string;
    end: string;
    startLocal: string;
    endLocal: string;
    allDay: boolean;
    snippet: string | null;
  }>;
};

function formatLocalTimestampForConflict(valueIso: string, timeZone: string): string {
  const parsed = new Date(valueIso);
  if (!Number.isFinite(parsed.getTime())) return valueIso;
  return formatDateTimeForUser(parsed, timeZone);
}

function computeConflictGroups(params: {
  events: ConflictEvent[];
  timeZone: string;
  includeAllDay: boolean;
}): ConflictGroup[] {
  const filtered = params.events
    .filter((ev) => params.includeAllDay || !ev.allDay)
    .filter((ev) => Number.isFinite(ev.startMs) && Number.isFinite(ev.endMs) && ev.startMs < ev.endMs)
    .sort((a, b) => (a.startMs - b.startMs) || (a.endMs - b.endMs) || a.id.localeCompare(b.id));

  const groups: ConflictGroup[] = [];
  let current: { startMs: number; endMs: number; events: ConflictEvent[] } | null = null;

  const finalize = () => {
    if (!current) return;
    if (current.events.length < 2) {
      current = null;
      return;
    }
    const startIso = new Date(current.startMs).toISOString();
    const endIso = new Date(current.endMs).toISOString();
    groups.push({
      start: startIso,
      end: endIso,
      startLocal: formatLocalTimestampForConflict(startIso, params.timeZone),
      endLocal: formatLocalTimestampForConflict(endIso, params.timeZone),
      events: current.events.map((ev) => ({
        id: ev.id,
        calendarId: ev.calendarId,
        title: ev.title,
        start: ev.start,
        end: ev.end,
        startLocal: formatLocalTimestampForConflict(ev.start, params.timeZone),
        endLocal: formatLocalTimestampForConflict(ev.end, params.timeZone),
        allDay: ev.allDay,
        snippet: ev.snippet,
      })),
    });
    current = null;
  };

  for (const ev of filtered) {
    if (!current) {
      current = { startMs: ev.startMs, endMs: ev.endMs, events: [ev] };
      continue;
    }

    // Strict overlap only; end == start is not a conflict.
    if (ev.startMs < current.endMs) {
      current.events.push(ev);
      if (ev.endMs > current.endMs) current.endMs = ev.endMs;
      continue;
    }

    finalize();
    current = { startMs: ev.startMs, endMs: ev.endMs, events: [ev] };
  }

  finalize();
  return groups;
}

export function createCalendarCapabilities(env: CapabilityEnvironment): CalendarCapabilities {
  const provider = env.toolContext.providers.calendar;
  const rescheduleWindowDurationMs = 14 * 24 * 60 * 60 * 1000;

  let defaultTimeZonePromise:
    | Promise<{ timeZone: string } | { error: string }>
    | null = null;

  const getDefaultTimeZone = async () => {
    if (!defaultTimeZonePromise) {
      defaultTimeZonePromise = resolveDefaultCalendarTimeZone({
        userId: env.runtime.userId,
        emailAccountId: env.runtime.emailAccountId,
      });
    }
    return defaultTimeZonePromise;
  };

  const resolveEffectiveTimeZone = async (
    requestedTimeZone?: string,
  ): Promise<{ timeZone: string } | { error: string }> => {
    const defaultTimeZone = await getDefaultTimeZone();
    if ("error" in defaultTimeZone) return defaultTimeZone;
    const resolved = resolveCalendarTimeZoneForRequest({
      requestedTimeZone,
      defaultTimeZone: defaultTimeZone.timeZone,
    });
    if ("error" in resolved) return { error: resolved.error };
    return resolved;
  };

  const parseUserDate = async (
    rawValue: unknown,
    kind: "start" | "end",
    requestedTimeZone?: string,
  ): Promise<{ value?: Date } | { error: string }> => {
    const value = safeString(rawValue);
    if (!value) return {};
    const resolvedTimeZone = await resolveEffectiveTimeZone(requestedTimeZone);
    if ("error" in resolvedTimeZone) return resolvedTimeZone;
    const parsed = parseDateBoundInTimeZone(value, resolvedTimeZone.timeZone, kind);
    if (!parsed) {
      return {
        error: `Invalid ${kind} datetime "${value}". Use ISO-8601 or local datetime.`,
      };
    }
    return { value: parsed };
  };

  const resolveRequestedTimeZone = (
    source?: Record<string, unknown>,
    nested?: Record<string, unknown>,
  ): string | undefined =>
    safeString(source?.timeZone) ??
    safeString(source?.timezone) ??
    safeString(nested?.timeZone) ??
    safeString(nested?.timezone);

  const formatLocalTimestamp = (
    value: string | null,
    timeZone: string | undefined,
  ): string | null => {
    if (!value || !timeZone) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return formatDateTimeForUser(parsed, timeZone);
  };

  const resolveUnifiedCalendarDateRange = async (
    source: Record<string, unknown>,
  ): Promise<
    | {
        range: { start: Date; end: Date };
        timeZone?: string;
      }
    | { errorResult: ToolResult }
  > => {
    const resolvedWindow = await normalizeTemporalRange({
      userId: env.runtime.userId,
      emailAccountId: env.runtime.emailAccountId,
      source: {
        ...source,
        referenceText:
          safeString(source.query) ??
          safeString(source.text) ??
          env.runtime.currentMessage,
      },
      defaultWindow: "today",
      missingBoundDurationMs: rescheduleWindowDurationMs,
    });

    if (!resolvedWindow.ok || !resolvedWindow.start || !resolvedWindow.end) {
      return {
        errorResult: {
          success: false,
          error: "invalid_event_window",
          message: !resolvedWindow.ok
            ? resolvedWindow.error
            : "I couldn't resolve the requested calendar window.",
          clarification: {
            kind: "invalid_fields",
            prompt: "calendar_date_range_invalid",
            missingFields: ["dateRange.after", "dateRange.before"],
          },
        },
      };
    }

    return {
      range: {
        start: resolvedWindow.start,
        end: resolvedWindow.end,
      },
      timeZone: resolvedWindow.timeZone,
    };
  };

  return {
    async findAvailability(filter) {
      // NOTE: This is intentionally NOT "query calendar events".
      // It computes free slots using the calendar provider's scheduling primitives.
      try {
        const durationMinutesRaw = (filter as Record<string, unknown>).durationMinutes ?? (filter as Record<string, unknown>).duration;
        const durationMinutes = Math.max(
          5,
          Number.isFinite(Number(durationMinutesRaw)) ? Number(durationMinutesRaw) : 30,
        );
        const requestedTimeZone = resolveRequestedTimeZone(filter as Record<string, unknown>);
        const startResult = await parseUserDate(
          (filter as Record<string, unknown>).start,
          "start",
          requestedTimeZone,
        );
        if ("error" in startResult) {
          return {
            success: false,
            error: "invalid_availability_start",
            message: startResult.error,
            clarification: {
              kind: "invalid_fields",
              prompt: "calendar_availability_start_invalid",
              missingFields: ["start"],
            },
          };
        }
        const endResult = await parseUserDate(
          (filter as Record<string, unknown>).end,
          "end",
          requestedTimeZone,
        );
        if ("error" in endResult) {
          return {
            success: false,
            error: "invalid_availability_end",
            message: endResult.error,
            clarification: {
              kind: "invalid_fields",
              prompt: "calendar_availability_end_invalid",
              missingFields: ["end"],
            },
          };
        }
        const start = startResult.value;
        const end = endResult.value;

        const slots = await findCalendarAvailability(provider, {
          durationMinutes,
          ...(start ? { start } : {}),
          ...(end ? { end } : {}),
        });

        return {
          success: true,
          data: { slots },
          meta: { resource: "calendar", itemCount: slots.length },
          message:
            slots.length === 0
              ? "No available slots found in that window."
              : `Found ${slots.length} available slots.`,
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't compute availability right now.");
      }
    },

    async listEvents(filter) {
      try {
        const filterRecord = filter as Record<string, unknown>;
        const resolvedDateRange = await resolveUnifiedCalendarDateRange(filterRecord);
        if ("errorResult" in resolvedDateRange) return resolvedDateRange.errorResult;

        const calendarIds = Array.from(
          new Set([
            ...toStringArray(filterRecord.calendarIds),
            ...(safeString(filterRecord.calendarId) ? [safeString(filterRecord.calendarId)!] : []),
          ]),
        ).filter(Boolean);
        const attendeeEmail =
          safeString(filterRecord.attendeeEmail) ??
          safeString(filterRecord.attendee);
        const titleQuery =
          safeString(filterRecord.query) ??
          safeString(filterRecord.titleContains) ??
          safeString(filterRecord.text) ??
          "";
        const locationContains =
          safeString(filterRecord.locationContains) ??
          safeString(filterRecord.location);
        const limit =
          typeof filterRecord.limit === "number" && Number.isFinite(filterRecord.limit)
            ? Math.max(1, Math.trunc(filterRecord.limit))
            : 200;

        const events = await provider.searchEvents(
          titleQuery,
          resolvedDateRange.range,
          attendeeEmail,
        );

        const filteredByCalendar = calendarIds.length > 0
          ? events.filter((event) => event.calendarId && calendarIds.includes(event.calendarId))
          : events;
        const filteredByLocation =
          locationContains && locationContains.length > 0
            ? filteredByCalendar.filter((event) =>
                `${event.location ?? ""}`.toLowerCase().includes(locationContains.toLowerCase()),
              )
            : filteredByCalendar;
        const data = filteredByLocation
          .slice(0, limit)
          .map((event) => {
            const start = event.startTime.toISOString();
            const end = event.endTime.toISOString();
            const eventTimeZone =
              resolvedDateRange.timeZone ??
              safeString(filterRecord.timeZone);
            return {
              id: event.id,
              title: event.title,
              start,
              end,
              startLocal: formatLocalTimestamp(start, eventTimeZone),
              endLocal: formatLocalTimestamp(end, eventTimeZone),
              attendees: event.attendees ?? [],
              organizerEmail: event.organizerEmail ?? null,
              calendarId: event.calendarId ?? null,
              location: event.location ?? null,
              snippet: event.description ?? "",
            };
          });

        return {
          success: true,
          data,
          meta: { resource: "calendar", itemCount: data.length },
          message:
            data.length === 0
              ? "No events found in that window."
              : `Found ${data.length} calendar event${data.length === 1 ? "" : "s"}.`,
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't load calendar events right now.");
      }
    },

    async detectConflicts(filter) {
      try {
        const filterRecord = filter as Record<string, unknown>;
        const resolvedDateRange = await resolveUnifiedCalendarDateRange(filterRecord);
        if ("errorResult" in resolvedDateRange) return resolvedDateRange.errorResult;

        const includeAllDay =
          typeof filterRecord.includeAllDay === "boolean"
            ? filterRecord.includeAllDay
            : Boolean(filterRecord.includeAllDay);

        const calendarIds = Array.from(
          new Set([
            ...toStringArray(filterRecord.calendarIds),
            ...(safeString(filterRecord.calendarId) ? [safeString(filterRecord.calendarId)!] : []),
          ]),
        ).filter(Boolean);
        const attendeeEmail =
          safeString(filterRecord.attendeeEmail) ??
          safeString(filterRecord.attendee);
        const titleQuery =
          safeString(filterRecord.query) ??
          safeString(filterRecord.titleContains) ??
          safeString(filterRecord.text) ??
          "";
        const locationContains =
          safeString(filterRecord.locationContains) ??
          safeString(filterRecord.location);
        const limit =
          typeof filterRecord.limit === "number" && Number.isFinite(filterRecord.limit)
            ? Math.max(1, Math.trunc(filterRecord.limit))
            : 200;

        const providerEvents = await provider.searchEvents(
          titleQuery,
          resolvedDateRange.range,
          attendeeEmail,
        );
        const filteredByCalendar = calendarIds.length > 0
          ? providerEvents.filter((event) => event.calendarId && calendarIds.includes(event.calendarId))
          : providerEvents;
        const filteredByLocation =
          locationContains && locationContains.length > 0
            ? filteredByCalendar.filter((event) =>
                `${event.location ?? ""}`.toLowerCase().includes(locationContains.toLowerCase()),
              )
            : filteredByCalendar;
        const events: ConflictEvent[] = filteredByLocation
          .slice(0, limit)
          .map((event) => {
            const start = event.startTime.toISOString();
            const end = event.endTime.toISOString();
            const startMs = Date.parse(start);
            const endMs = Date.parse(end);
            return {
              id: event.id,
              calendarId: event.calendarId ?? null,
              title: event.title ?? null,
              start,
              end,
              startMs,
              endMs,
              allDay: Boolean(event.isAllDay),
              snippet: event.description ?? null,
            } satisfies ConflictEvent;
          });

        const timeZone =
          resolvedDateRange.timeZone ??
          safeString(filterRecord.timeZone) ??
          safeString(filterRecord.timezone) ??
          "UTC";

        const conflicts = computeConflictGroups({
          events,
          timeZone,
          includeAllDay,
        });

        return {
          success: true,
          data: {
            hasConflicts: conflicts.length > 0,
            conflicts,
            countGroups: conflicts.length,
            countEventsInConflicts: conflicts.reduce((sum, group) => sum + group.events.length, 0),
          },
          meta: { resource: "calendar", itemCount: conflicts.length },
          message:
            conflicts.length === 0
              ? "No overlaps found in that window."
              : `Found ${conflicts.length} conflict group${conflicts.length === 1 ? "" : "s"}.`,
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't check for overlaps right now.");
      }
    },

    async searchEventsByAttendee(filter) {
      try {
        const filterRecord = filter as Record<string, unknown>;
        const resolvedDateRange = await resolveUnifiedCalendarDateRange(filterRecord);
        if ("errorResult" in resolvedDateRange) return resolvedDateRange.errorResult;

        const attendeeEmail =
          safeString(filterRecord.attendeeEmail) ??
          safeString(filterRecord.attendee) ??
          safeString(filterRecord.email);
        const calendarIds = Array.from(
          new Set([
            ...toStringArray(filterRecord.calendarIds),
            ...(safeString(filterRecord.calendarId) ? [safeString(filterRecord.calendarId)!] : []),
          ]),
        ).filter(Boolean);
        const locationContains =
          safeString(filterRecord.locationContains) ??
          safeString(filterRecord.location);
        const titleQuery =
          safeString(filterRecord.query) ??
          safeString(filterRecord.titleContains) ??
          safeString(filterRecord.text) ??
          "";
        const limit =
          typeof filterRecord.limit === "number" && Number.isFinite(filterRecord.limit)
            ? Math.max(1, Math.trunc(filterRecord.limit))
            : 200;

        const events = await provider.searchEvents(
          titleQuery,
          resolvedDateRange.range,
          attendeeEmail,
        );
        const filteredByCalendar = calendarIds.length > 0
          ? events.filter((event) => event.calendarId && calendarIds.includes(event.calendarId))
          : events;
        const filteredByLocation =
          locationContains && locationContains.length > 0
            ? filteredByCalendar.filter((event) =>
                `${event.location ?? ""}`.toLowerCase().includes(locationContains.toLowerCase()),
              )
            : filteredByCalendar;
        const data = filteredByLocation
          .slice(0, limit)
          .map((event) => {
            const start = event.startTime.toISOString();
            const end = event.endTime.toISOString();
            const eventTimeZone =
              resolvedDateRange.timeZone ??
              safeString(filterRecord.timeZone);
            return {
              id: event.id,
              title: event.title,
              start,
              end,
              startLocal: formatLocalTimestamp(start, eventTimeZone),
              endLocal: formatLocalTimestamp(end, eventTimeZone),
              attendees: event.attendees ?? [],
              location: event.location ?? null,
              snippet: event.description ?? "",
            };
          });

        return {
          success: true,
          data,
          meta: { resource: "calendar", itemCount: data.length },
          message:
            data.length === 0
              ? "No attendee-matching events found in that window."
              : `Found ${data.length} attendee-matching event${data.length === 1 ? "" : "s"}.`,
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't load attendee events right now.");
      }
    },

    async getEvent(input) {
      const eventId = safeString(input.eventId);
      if (!eventId) {
        return {
          success: false,
          error: "event_id_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "calendar_event_id_required",
            missingFields: ["event_id"],
          },
        };
      }
      try {
        const event = await getCalendarEvent(provider, {
          eventId,
          ...(safeString(input.calendarId) ? { calendarId: safeString(input.calendarId) } : {}),
        });
        return {
          success: true,
          data: event,
          message: event ? "Event loaded." : "Event not found.",
          meta: { resource: "calendar", itemCount: event ? 1 : 0 },
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't load that event right now.");
      }
    },

    async listCalendars() {
      try {
        const connections = await prisma.calendarConnection.findMany({
          where: {
            emailAccountId: env.runtime.emailAccountId,
            isConnected: true,
            emailAccount: { userId: env.runtime.userId },
          },
          select: {
            provider: true,
            email: true,
            calendars: {
              select: {
                calendarId: true,
                name: true,
                description: true,
                primary: true,
                isEnabled: true,
                createdAt: true,
              },
            },
          },
        });

        const calendars = connections.flatMap((connection) =>
          connection.calendars.map((calendar) => ({
            calendarId: calendar.calendarId,
            name: calendar.name,
            description: calendar.description,
            provider: connection.provider,
            connectionEmail: connection.email,
            primary: calendar.primary,
            isEnabled: calendar.isEnabled,
            isLikelyNoisy: isLikelyNoisyCalendar({
              calendarId: calendar.calendarId,
              name: calendar.name,
              description: calendar.description,
              provider: connection.provider,
            }),
            createdAt: calendar.createdAt.toISOString(),
          })),
        );

        const enabledCount = calendars.filter((c) => c.isEnabled).length;
        return {
          success: true,
          data: calendars,
          meta: { resource: "calendar", itemCount: calendars.length },
          message:
            calendars.length === 0
              ? "No connected calendars found."
              : `Found ${calendars.length} calendar${calendars.length === 1 ? "" : "s"} (${enabledCount} enabled).`,
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't list your calendars right now.");
      }
    },

    async setEnabledCalendars(input) {
      const enableOnlyIds = toStringArray(input.enableOnlyIds);
      const enableIds = toStringArray(input.enableIds);
      const disableIds = toStringArray(input.disableIds);
      const enablePrimaryNonNoisy = input.enablePrimaryNonNoisy === true;

      try {
        let enabledAdded = 0;
        let enabledRemoved = 0;

        if (enableOnlyIds.length > 0) {
          const disableAll = await prisma.calendar.updateMany({
            where: {
              connection: {
                emailAccountId: env.runtime.emailAccountId,
                isConnected: true,
              },
              isEnabled: true,
              calendarId: { notIn: enableOnlyIds },
            },
            data: { isEnabled: false },
          });
          enabledRemoved += disableAll.count;

          const enableSome = await prisma.calendar.updateMany({
            where: {
              connection: {
                emailAccountId: env.runtime.emailAccountId,
                isConnected: true,
              },
              calendarId: { in: enableOnlyIds },
              isEnabled: false,
            },
            data: { isEnabled: true },
          });
          enabledAdded += enableSome.count;
        } else {
          if (disableIds.length > 0) {
            const res = await prisma.calendar.updateMany({
              where: {
                connection: {
                  emailAccountId: env.runtime.emailAccountId,
                  isConnected: true,
                },
                calendarId: { in: disableIds },
                isEnabled: true,
              },
              data: { isEnabled: false },
            });
            enabledRemoved += res.count;
          }
          if (enableIds.length > 0) {
            const res = await prisma.calendar.updateMany({
              where: {
                connection: {
                  emailAccountId: env.runtime.emailAccountId,
                  isConnected: true,
                },
                calendarId: { in: enableIds },
                isEnabled: false,
              },
              data: { isEnabled: true },
            });
            enabledAdded += res.count;
          }
        }

        const invariant = enablePrimaryNonNoisy
          ? await ensureCalendarSelectionInvariant({
              userId: env.runtime.userId,
              emailAccountId: env.runtime.emailAccountId,
              logger: env.runtime.logger,
              source: "calendar.setEnabledCalendars",
            })
          : null;

        return {
          success: true,
          data: {
            enabledAdded,
            enabledRemoved,
            ...(invariant ? { invariant } : {}),
          },
          message: enablePrimaryNonNoisy
            ? "Updated enabled calendars and re-applied selection invariant."
            : "Updated enabled calendars.",
          meta: { resource: "preferences", itemCount: 1 },
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't update enabled calendars right now.");
      }
    },

    async setSelectedCalendars(input) {
      const selected = Array.from(new Set(toStringArray(input.selectedCalendarIds)));
      if (selected.length === 0) {
        return {
          success: false,
          error: "selected_calendars_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "calendar_selection_required",
            missingFields: ["selectedCalendarIds"],
          },
        };
      }
      try {
        const updated = await prisma.taskPreference.upsert({
          where: { userId: env.runtime.userId },
          create: {
            userId: env.runtime.userId,
            selectedCalendarIds: selected,
          },
          update: {
            selectedCalendarIds: selected,
          },
        });

        return {
          success: true,
          data: { selectedCalendarIds: updated.selectedCalendarIds },
          message: "Selected calendars updated.",
          meta: { resource: "preferences", itemCount: 1 },
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't update selected calendars right now.");
      }
    },

    async createEvent(data) {
      return runMutationWithIdempotency({
        env,
        capability: "calendar.createEvent",
        payload: {
          title: safeString(data.title) ?? "New event",
          start: safeString(data.start) ?? null,
          end: safeString(data.end) ?? null,
          attendees: toStringArray(data.attendees),
          location: safeString(data.location) ?? null,
          description: safeString(data.description) ?? null,
          timeZone: safeString(data.timeZone) ?? safeString(data.timezone) ?? null,
        },
        execute: async () => {
          const title = safeString(data.title) ?? "New event";
          const requestedTimeZone = resolveRequestedTimeZone(data);
          const resolvedTimeZone = await resolveEffectiveTimeZone(requestedTimeZone);
          if ("error" in resolvedTimeZone) {
            return {
              success: false,
              error: "invalid_time_zone",
              message: resolvedTimeZone.error,
              clarification: {
                kind: "invalid_fields",
                prompt: "calendar_timezone_invalid",
                missingFields: ["timeZone"],
              },
            };
          }
          const start = parseDateBoundInTimeZone(
            safeString(data.start),
            resolvedTimeZone.timeZone,
            "start",
          );
          const end = parseDateBoundInTimeZone(
            safeString(data.end),
            resolvedTimeZone.timeZone,
            "end",
          );
          if (!start || !end || start.getTime() >= end.getTime()) {
            return {
              success: false,
              error: "invalid_event_time",
              clarification: {
                kind: "missing_fields",
                prompt: "calendar_event_time_required",
                missingFields: ["start", "end"],
              },
            };
          }

          const attendees = Array.isArray(data.attendees)
            ? data.attendees.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            : [];

          try {
            const event = await createCalendarEvent(provider, {
              event: {
                title,
                start,
                end,
                ...(attendees.length > 0 ? { attendees } : {}),
                ...(safeString(data.location) ? { location: safeString(data.location) } : {}),
                ...(safeString(data.description) ? { description: safeString(data.description) } : {}),
                timeZone: resolvedTimeZone.timeZone,
              },
            });

            return {
              success: true,
              data: {
                id: event.id,
                title: event.title,
                start: event.startTime.toISOString(),
                end: event.endTime.toISOString(),
                startLocal: formatDateTimeForUser(
                  event.startTime,
                  resolvedTimeZone.timeZone,
                ),
                endLocal: formatDateTimeForUser(
                  event.endTime,
                  resolvedTimeZone.timeZone,
                ),
                attendees: event.attendees.map((attendee) => attendee.email),
              },
              message: "Event created.",
              meta: { resource: "calendar", itemCount: 1 },
            };
          } catch (error) {
            return calendarFailure(error, "I couldn't create that event right now.");
          }
        },
      });
    },

    async updateEvent(input) {
      const eventId = safeString(input.eventId);
      if (!eventId) {
        return {
          success: false,
          error: "event_id_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "calendar_event_id_required",
            missingFields: ["event_id"],
          },
        };
      }

      const changes = input.changes ?? {};
      const attendees = toStringArray((changes as Record<string, unknown>).attendees);
      const modeRaw = safeString((changes as Record<string, unknown>).mode);
      const mode = modeRaw === "single" || modeRaw === "series" ? modeRaw : undefined;
      const instanceId = safeString((changes as Record<string, unknown>).instanceId);
      const originalStartTime = safeString(
        (changes as Record<string, unknown>).originalStartTime,
      );
      const requestedTimeZone = resolveRequestedTimeZone(changes as Record<string, unknown>);

      return runMutationWithIdempotency({
        env,
        capability: "calendar.updateEvent",
        payload: {
          eventId,
          calendarId: safeString(input.calendarId) ?? null,
          changes,
        },
        execute: async () => {
          try {
        if (mode === "single") {
          const existingEvent = await getCalendarEvent(provider, {
            eventId,
            ...(safeString(input.calendarId)
              ? { calendarId: safeString(input.calendarId) }
              : {}),
          });
          const isRecurringEvent = Boolean(
            existingEvent?.seriesMasterId ||
            (Array.isArray(existingEvent?.instances) && existingEvent.instances.length > 0),
          );
          if (isRecurringEvent && !instanceId && !originalStartTime) {
            return {
              success: false,
              error: "recurring_instance_identity_required",
              clarification: {
                kind: "missing_fields",
                prompt: "calendar_recurring_instance_identity_required",
                missingFields: ["changes.instanceId_or_originalStartTime"],
              },
            };
          }
        }

        const resolvedTimeZone = await resolveEffectiveTimeZone(requestedTimeZone);
        if ("error" in resolvedTimeZone) {
          return {
            success: false,
            error: "invalid_time_zone",
            message: resolvedTimeZone.error,
            clarification: {
              kind: "invalid_fields",
              prompt: "calendar_timezone_invalid",
              missingFields: ["changes.timeZone"],
            },
          };
        }
        const startRaw = safeString((changes as Record<string, unknown>).start);
        const endRaw = safeString((changes as Record<string, unknown>).end);
        const start =
          startRaw != null
            ? parseDateBoundInTimeZone(startRaw, resolvedTimeZone.timeZone, "start")
            : undefined;
        const end =
          endRaw != null
            ? parseDateBoundInTimeZone(endRaw, resolvedTimeZone.timeZone, "end")
            : undefined;
        if ((startRaw && !start) || (endRaw && !end)) {
          return {
            success: false,
            error: "invalid_event_time",
            clarification: {
              kind: "invalid_fields",
              prompt: "calendar_event_time_invalid",
              missingFields: ["changes.start", "changes.end"],
            },
          };
        }
        const updated = await updateCalendarEvent(provider, {
          ...(safeString(input.calendarId)
            ? { calendarId: safeString(input.calendarId) }
            : {}),
          eventId,
          event: {
            ...(safeString((changes as Record<string, unknown>).title)
              ? { title: safeString((changes as Record<string, unknown>).title) }
              : {}),
            ...(safeString((changes as Record<string, unknown>).description)
              ? { description: safeString((changes as Record<string, unknown>).description) }
              : {}),
            ...(safeString((changes as Record<string, unknown>).location)
              ? { location: safeString((changes as Record<string, unknown>).location) }
              : {}),
            ...(start ? { start } : {}),
            ...(end ? { end } : {}),
            ...(attendees.length > 0 ? { attendees } : {}),
            timeZone: resolvedTimeZone.timeZone,
            ...(mode ? { mode } : {}),
            ...(instanceId ? { instanceId } : {}),
            ...(originalStartTime ? { originalStartTime } : {}),
          },
        });

        return {
          success: true,
          data: {
            id: updated.id,
            title: updated.title,
            start: updated.startTime.toISOString(),
            end: updated.endTime.toISOString(),
            startLocal: formatDateTimeForUser(
              updated.startTime,
              resolvedTimeZone.timeZone,
            ),
            endLocal: formatDateTimeForUser(
              updated.endTime,
              resolvedTimeZone.timeZone,
            ),
            attendees: updated.attendees.map((attendee) => attendee.email),
          },
          message: "Event updated.",
          meta: { resource: "calendar", itemCount: 1 },
        };
          } catch (error) {
            return calendarFailure(error, "I couldn't update that event right now.");
          }
        },
      });
    },

    async deleteEvent(input) {
      const eventId = safeString(input.eventId);
      if (!eventId) {
        return {
          success: false,
          error: "event_id_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "calendar_event_id_required",
            missingFields: ["event_id"],
          },
        };
      }
      const mode = input.mode === "single" || input.mode === "series" ? input.mode : "single";
      const instanceId = safeString(input.instanceId);
      const originalStartTime = safeString(input.originalStartTime);
      return runMutationWithIdempotency({
        env,
        capability: "calendar.deleteEvent",
        payload: {
          eventId,
          calendarId: safeString(input.calendarId) ?? null,
          mode,
          instanceId: instanceId ?? null,
          originalStartTime: originalStartTime ?? null,
        },
        execute: async () => {
          try {
        if (mode === "single") {
          const existingEvent = await getCalendarEvent(provider, {
            eventId,
            ...(safeString(input.calendarId)
              ? { calendarId: safeString(input.calendarId) }
              : {}),
          });
          const isRecurringEvent = Boolean(
            existingEvent?.seriesMasterId ||
            (Array.isArray(existingEvent?.instances) && existingEvent.instances.length > 0),
          );
          if (isRecurringEvent && !instanceId && !originalStartTime) {
            return {
              success: false,
              error: "recurring_instance_identity_required",
              clarification: {
                kind: "missing_fields",
                prompt: "calendar_recurring_instance_identity_required",
                missingFields: ["instanceId_or_originalStartTime"],
              },
            };
          }
        }

        await deleteCalendarEvent(provider, {
          ...(safeString(input.calendarId)
            ? { calendarId: safeString(input.calendarId) }
            : {}),
          eventId,
          deleteOptions: {
            mode,
            ...(instanceId ? { instanceId } : {}),
            ...(originalStartTime ? { originalStartTime } : {}),
          },
        });
        return {
          success: true,
          data: {
            eventId,
            mode,
            ...(instanceId ? { instanceId } : {}),
            ...(originalStartTime ? { originalStartTime } : {}),
          },
          message: "Event deleted.",
          meta: { resource: "calendar", itemCount: 1 },
        };
          } catch (error) {
            return calendarFailure(error, "I couldn't delete that event right now.");
          }
        },
      });
    },

    async manageAttendees(input) {
      const eventId = safeString(input.eventId);
      if (!eventId) {
        return {
          success: false,
          error: "event_id_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "calendar_event_id_required",
            missingFields: ["event_id"],
          },
        };
      }
      const attendees = toStringArray(input.attendees);
      if (attendees.length === 0) {
        return {
          success: false,
          error: "attendees_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "calendar_event_attendees_required",
            missingFields: ["attendees"],
          },
        };
      }

      const mode = input.mode === "single" || input.mode === "series" ? input.mode : "single";
      try {
        const updated = await updateCalendarEvent(provider, {
          ...(safeString(input.calendarId)
            ? { calendarId: safeString(input.calendarId) }
            : {}),
          eventId,
          event: { attendees, mode },
        });
        return {
          success: true,
          data: {
            id: updated.id,
            attendees: updated.attendees.map((attendee) => attendee.email),
            mode,
          },
          message: "Attendees updated.",
          meta: { resource: "calendar", itemCount: 1 },
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't update attendees right now.");
      }
    },

    async updateRecurringMode(input) {
      const eventId = safeString(input.eventId);
      if (!eventId) {
        return {
          success: false,
          error: "event_id_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "calendar_event_id_required",
            missingFields: ["event_id"],
          },
        };
      }

      try {
        const defaultTimeZone = await getDefaultTimeZone();
        const displayTimeZone =
          "error" in defaultTimeZone ? "UTC" : defaultTimeZone.timeZone;
        const updated = await updateCalendarEvent(provider, {
          ...(safeString(input.calendarId)
            ? { calendarId: safeString(input.calendarId) }
            : {}),
          eventId,
          event: {
            ...(input.changes ?? {}),
            mode: input.mode,
          },
        });
        return {
          success: true,
          data: {
            id: updated.id,
            mode: input.mode,
            start: updated.startTime.toISOString(),
            end: updated.endTime.toISOString(),
            startLocal: formatDateTimeForUser(
              updated.startTime,
              displayTimeZone,
            ),
            endLocal: formatDateTimeForUser(
              updated.endTime,
              displayTimeZone,
            ),
          },
          message: "Recurring event updated.",
          meta: { resource: "calendar", itemCount: 1 },
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't update that recurring event right now.");
      }
    },

    async rescheduleEvent(input) {
      const changes =
        input.changes && typeof input.changes === "object" && !Array.isArray(input.changes)
          ? (input.changes as Record<string, unknown>)
          : {};

      const explicitIds = Array.isArray(input.eventIds)
        ? input.eventIds.map((id) => id.trim()).filter(Boolean)
        : [];

      const resolveTargets = async (): Promise<
        | { ok: true; eventIds: string[] }
        | { ok: false; result: ToolResult }
      > => {
        if (explicitIds.length > 0) return { ok: true, eventIds: explicitIds };

        const filter = input.filter ?? {};
        const query = safeString(filter.query) ?? safeString(filter.titleContains) ?? safeString(filter.text);
        const attendeeEmail = safeString(filter.attendeeEmail);
        const calendarIds = Array.from(
          new Set([
            ...toStringArray(filter.calendarIds),
            ...(safeString(filter.calendarId) ? [safeString(filter.calendarId)!] : []),
          ]),
        ).filter(Boolean);
        const dateRange =
          filter.dateRange && typeof filter.dateRange === "object" && !Array.isArray(filter.dateRange)
            ? (filter.dateRange as Record<string, unknown>)
            : {
                after: safeString(filter.after),
                before: safeString(filter.before),
                timeZone: safeString(filter.timeZone) ?? safeString(changes.timeZone) ?? safeString(changes.timezone),
              };
        const limitRaw = typeof filter.limit === "number" ? filter.limit : undefined;
        const limit = typeof limitRaw === "number" && Number.isFinite(limitRaw)
          ? Math.min(10, Math.max(1, Math.trunc(limitRaw)))
          : 5;
        const requestedTimeZone =
          safeString(dateRange.timeZone) ??
          safeString(dateRange.timezone);
        const resolvedWindow = await resolveCalendarTimeRange({
          userId: env.runtime.userId,
          emailAccountId: env.runtime.emailAccountId,
          requestedTimeZone,
          dateRange: {
            after: safeString(dateRange.after),
            before: safeString(dateRange.before),
          },
          relativeDateHintText: query ?? undefined,
          defaultWindow: "next_7_days",
          missingBoundDurationMs: rescheduleWindowDurationMs,
        });
        if ("error" in resolvedWindow) {
          return {
            ok: false,
            result: {
              success: false,
              error: "invalid_event_window",
              message: resolvedWindow.error,
              clarification: {
                kind: "invalid_fields",
                prompt: "calendar_date_range_invalid",
                missingFields: ["filter.dateRange"],
              },
            },
          };
        }

        const events = await provider.searchEvents(
          query ?? "",
          { start: resolvedWindow.start, end: resolvedWindow.end },
          attendeeEmail,
        );
        const filteredByCalendar = calendarIds.length > 0
          ? events.filter((event) => event.calendarId && calendarIds.includes(event.calendarId))
          : events;
        const candidates = filteredByCalendar
          .slice(0, limit)
          .map((event) => ({
            eventId: event.id,
            title: event.title,
            start: event.startTime.toISOString(),
            end: event.endTime.toISOString(),
            organizerEmail: event.organizerEmail ?? null,
          }));

        if (candidates.length === 0) {
          return {
            ok: false,
            result: {
              success: false,
              error: "event_not_found",
              message: "I couldn't find a matching event to reschedule.",
              clarification: {
                kind: "missing_fields",
                prompt: "calendar_reschedule_target_required",
                missingFields: ["eventIds or filter"],
              },
            },
          };
        }

        if (candidates.length > 1) {
          return {
            ok: false,
            result: {
              success: false,
              error: "event_ambiguous",
              message: "I found multiple matching events.",
              clarification: {
                kind: "resource",
                prompt: "calendar_reschedule_target_ambiguous",
                missingFields: ["eventIds"],
              },
              data: { candidates: candidates.slice(0, 5) },
            },
          };
        }

        return { ok: true, eventIds: [candidates[0]!.eventId] };
      };

      const targets = await resolveTargets();
      if (!targets.ok) return targets.result;

      const rescheduleOne = async (targetEventId: string): Promise<ToolResult> => {
        const requestedTimeZone = resolveRequestedTimeZone(changes);
        const resolvedTimeZone = await resolveEffectiveTimeZone(requestedTimeZone);
        if ("error" in resolvedTimeZone) {
          return {
            success: false,
            error: "invalid_time_zone",
            message: resolvedTimeZone.error,
            clarification: {
              kind: "invalid_fields",
              prompt: "calendar_timezone_invalid",
              missingFields: ["timeZone"],
            },
          };
        }

        const explicitStartRaw = safeString(changes.start);
        const explicitEndRaw = safeString(changes.end);
        const explicitStart =
          explicitStartRaw != null
            ? parseDateBoundInTimeZone(explicitStartRaw, resolvedTimeZone.timeZone, "start")
            : undefined;
        const explicitEnd =
          explicitEndRaw != null
            ? parseDateBoundInTimeZone(explicitEndRaw, resolvedTimeZone.timeZone, "end")
            : undefined;

        if ((explicitStartRaw && !explicitStart) || (explicitEndRaw && !explicitEnd)) {
          return {
            success: false,
            error: "invalid_reschedule_window",
            message: "I need valid start/end values to reschedule. Use ISO-8601 or local datetime.",
          };
        }

        const current = await getCalendarEvent(provider, { eventId: targetEventId });
        if (!current) {
          return { success: false, error: "event_not_found", message: "I couldn't find that event." };
        }

        const durationMs = Math.max(
          15 * 60 * 1000,
          current.endTime.getTime() - current.startTime.getTime(),
        );

        let start = explicitStart;
        let end = explicitEnd;

        if (!start || !end) {
          const strategyRaw = safeString(changes.rescheduleStrategy) ?? safeString(changes.reschedule) ?? "next_available";
          const strategy = strategyRaw.toLowerCase();
          const windowStartRaw = safeString(changes.after) ?? safeString(changes.windowStart);
          const windowEndRaw = safeString(changes.before) ?? safeString(changes.windowEnd);
          const parsedWindowStart =
            windowStartRaw != null
              ? parseDateBoundInTimeZone(windowStartRaw, resolvedTimeZone.timeZone, "start")
              : undefined;
          const parsedWindowEnd =
            windowEndRaw != null
              ? parseDateBoundInTimeZone(windowEndRaw, resolvedTimeZone.timeZone, "end")
              : undefined;

          if ((windowStartRaw && !parsedWindowStart) || (windowEndRaw && !parsedWindowEnd)) {
            return {
              success: false,
              error: "invalid_reschedule_window",
              message: "I couldn't parse the reschedule window. Use ISO-8601 or local datetime values.",
            };
          }

          const windowStart = parsedWindowStart ?? new Date(current.endTime.getTime() + 60 * 1000);
          const windowEnd = parsedWindowEnd ?? new Date(windowStart.getTime() + rescheduleWindowDurationMs);
          const durationMinutes = Math.max(1, Math.round(durationMs / 60_000));
          const slots = await findCalendarAvailability(provider, {
            durationMinutes,
            start: windowStart,
            end: windowEnd,
          });
          if (slots.length === 0) {
            return {
              success: false,
              error: "no_valid_slot",
              message: "I couldn't find an available slot in that window.",
            };
          }
          const selected = strategy.includes("earlier")
            ? [...slots].sort((a, b) => b.start.getTime() - a.start.getTime())[0]
            : [...slots].sort((a, b) => a.start.getTime() - b.start.getTime())[0];
          start = selected?.start;
          end = selected?.end;
        }

        if (!start || !end || start.getTime() >= end.getTime()) {
          return {
            success: false,
            error: "invalid_reschedule_window",
            message: "I couldn't determine a valid new time.",
          };
        }

        const updateInput: CalendarEventUpdateInput = {
          start,
          end,
          timeZone: resolvedTimeZone.timeZone,
        };
        const updated = await updateCalendarEvent(provider, {
          eventId: targetEventId,
          event: updateInput,
        });

        return {
          success: true,
          data: {
            id: updated.id,
            previousStart: current.startTime.toISOString(),
            previousEnd: current.endTime.toISOString(),
            newStart: updated.startTime.toISOString(),
            newEnd: updated.endTime.toISOString(),
            previousStartLocal: formatDateTimeForUser(current.startTime, resolvedTimeZone.timeZone),
            previousEndLocal: formatDateTimeForUser(current.endTime, resolvedTimeZone.timeZone),
            newStartLocal: formatDateTimeForUser(updated.startTime, resolvedTimeZone.timeZone),
            newEndLocal: formatDateTimeForUser(updated.endTime, resolvedTimeZone.timeZone),
          },
          message: "Event rescheduled.",
          meta: { resource: "calendar", itemCount: 1 },
        };
      };

      try {
        const results: Array<{ eventId: string; ok: boolean; data?: unknown; error?: string }> = [];
        let okCount = 0;
        for (const eventId of targets.eventIds) {
          const result = await rescheduleOne(eventId);
          if (result.success) {
            okCount += 1;
            results.push({ eventId, ok: true, data: result.data });
          } else {
            results.push({ eventId, ok: false, error: result.error ?? result.message ?? "failed" });
          }
        }
        return {
          success: okCount === targets.eventIds.length,
          data: { attempted: targets.eventIds.length, rescheduled: okCount, results },
          message: `Rescheduled ${okCount} of ${targets.eventIds.length} event${targets.eventIds.length === 1 ? "" : "s"}.`,
          meta: { resource: "calendar", itemCount: okCount },
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't reschedule that event right now.");
      }
    },

    async setWorkingHours(changes) {
      try {
        const workHourStart =
          typeof changes.workHourStart === "number" ? changes.workHourStart : undefined;
        const workHourEnd =
          typeof changes.workHourEnd === "number" ? changes.workHourEnd : undefined;
        const workDays = Array.isArray(changes.workDays)
          ? changes.workDays.filter((value): value is number => typeof value === "number")
          : undefined;
        const timeZone = safeString(changes.timeZone);

        const updated = await prisma.taskPreference.upsert({
          where: { userId: env.runtime.userId },
          create: {
            userId: env.runtime.userId,
            ...(workHourStart !== undefined ? { workHourStart } : {}),
            ...(workHourEnd !== undefined ? { workHourEnd } : {}),
            ...(workDays ? { workDays } : {}),
            ...(timeZone ? { timeZone } : {}),
          },
          update: {
            ...(workHourStart !== undefined ? { workHourStart } : {}),
            ...(workHourEnd !== undefined ? { workHourEnd } : {}),
            ...(workDays ? { workDays } : {}),
            ...(timeZone ? { timeZone } : {}),
          },
        });

        return {
          success: true,
          data: {
            workHourStart: updated.workHourStart,
            workHourEnd: updated.workHourEnd,
            workDays: updated.workDays,
            timeZone: updated.timeZone,
          },
          message: "Working hours updated.",
          meta: { resource: "preferences", itemCount: 1 },
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't update working hours right now.");
      }
    },

    async setWorkingLocation(changes) {
      const location = safeString(changes.location) ?? safeString(changes.workingLocation);
      if (!location) {
        return {
          success: false,
          error: "working_location_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "calendar_working_location_required",
            missingFields: ["working_location"],
          },
        };
      }

      const requestedTimeZone = resolveRequestedTimeZone(changes);
      const resolvedTimeZone = await resolveEffectiveTimeZone(requestedTimeZone);
      if ("error" in resolvedTimeZone) {
        return {
          success: false,
          error: "invalid_time_zone",
          message: resolvedTimeZone.error,
          clarification: {
            kind: "invalid_fields",
            prompt: "calendar_timezone_invalid",
            missingFields: ["timeZone"],
          },
        };
      }

      const workingLocationWindow = await normalizeTemporalRange({
        userId: env.runtime.userId,
        emailAccountId: env.runtime.emailAccountId,
        source: {
          after: safeString(changes.start) ?? safeString(changes.date),
          before: safeString(changes.end) ?? safeString(changes.date),
          timeZone: resolvedTimeZone.timeZone,
          referenceText:
            safeString(changes.date) ??
            safeString(changes.start) ??
            env.toolContext.currentMessage,
        },
        defaultWindow: "today",
        missingBoundDurationMs: 24 * 60 * 60 * 1_000,
      });

      if (!workingLocationWindow.ok || !workingLocationWindow.start || !workingLocationWindow.end) {
        return {
          success: false,
          error: "invalid_working_location_window",
          message: !workingLocationWindow.ok
            ? workingLocationWindow.error
            : "I couldn't resolve that date window.",
          clarification: {
            kind: "missing_fields",
            prompt: "calendar_working_location_time_invalid",
            missingFields: ["date_or_window"],
          },
        };
      }
      const start = workingLocationWindow.start;
      const end = workingLocationWindow.end;

      try {
        const event = await createCalendarEvent(provider, {
          event: {
            title: `Working from ${location}`,
            location,
            start,
            end,
            allDay: true,
            timeZone: resolvedTimeZone.timeZone,
          },
        });
        return {
          success: true,
          data: {
            id: event.id,
            start: event.startTime.toISOString(),
            end: event.endTime.toISOString(),
            startLocal: formatDateTimeForUser(event.startTime, resolvedTimeZone.timeZone),
            endLocal: formatDateTimeForUser(event.endTime, resolvedTimeZone.timeZone),
            location,
            timeZone: resolvedTimeZone.timeZone,
          },
          message: "Working location saved as a calendar block.",
          meta: { resource: "calendar", itemCount: 1 },
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't set working location right now.");
      }
    },

    async setOutOfOffice(data) {
      const requestedTimeZone = resolveRequestedTimeZone(data);
      const resolvedTimeZone = await resolveEffectiveTimeZone(requestedTimeZone);
      if ("error" in resolvedTimeZone) {
        return {
          success: false,
          error: "invalid_time_zone",
          message: resolvedTimeZone.error,
          clarification: {
            kind: "invalid_fields",
            prompt: "calendar_timezone_invalid",
            missingFields: ["timeZone"],
          },
        };
      }
      const start = parseDateBoundInTimeZone(
        safeString(data.start),
        resolvedTimeZone.timeZone,
        "start",
      );
      const end = parseDateBoundInTimeZone(
        safeString(data.end),
        resolvedTimeZone.timeZone,
        "end",
      );
      if (!start || !end || start.getTime() >= end.getTime()) {
        return {
          success: false,
          error: "invalid_ooo_window",
          clarification: {
            kind: "missing_fields",
            prompt: "calendar_out_of_office_time_required",
            missingFields: ["ooo_window.start", "ooo_window.end"],
          },
        };
      }
      try {
        const event = await createCalendarEvent(provider, {
          event: {
            title: safeString(data.title) ?? "Out of office",
            start,
            end,
            timeZone: resolvedTimeZone.timeZone,
            ...(safeString(data.location) ? { location: safeString(data.location) } : {}),
          },
        });
        return {
          success: true,
          data: {
            id: event.id,
            start: event.startTime.toISOString(),
            end: event.endTime.toISOString(),
            startLocal: formatDateTimeForUser(
              event.startTime,
              resolvedTimeZone.timeZone,
            ),
            endLocal: formatDateTimeForUser(
              event.endTime,
              resolvedTimeZone.timeZone,
            ),
          },
          message: "Out-of-office event created.",
          meta: { resource: "calendar", itemCount: 1 },
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't set out-of-office right now.");
      }
    },

    async createFocusBlock(data) {
      const requestedTimeZone = resolveRequestedTimeZone(data);
      const resolvedTimeZone = await resolveEffectiveTimeZone(requestedTimeZone);
      if ("error" in resolvedTimeZone) {
        return {
          success: false,
          error: "invalid_time_zone",
          message: resolvedTimeZone.error,
          clarification: {
            kind: "invalid_fields",
            prompt: "calendar_timezone_invalid",
            missingFields: ["timeZone"],
          },
        };
      }
      const start = parseDateBoundInTimeZone(
        safeString(data.start),
        resolvedTimeZone.timeZone,
        "start",
      );
      const end = parseDateBoundInTimeZone(
        safeString(data.end),
        resolvedTimeZone.timeZone,
        "end",
      );
      if (!start || !end || start.getTime() >= end.getTime()) {
        return {
          success: false,
          error: "invalid_focus_window",
          clarification: {
            kind: "missing_fields",
            prompt: "calendar_focus_block_time_required",
            missingFields: ["focus_block_window.start", "focus_block_window.end"],
          },
        };
      }
      try {
        const event = await createCalendarEvent(provider, {
          event: {
            title: safeString(data.title) ?? "Focus time",
            start,
            end,
            timeZone: resolvedTimeZone.timeZone,
            ...(safeString(data.description) ? { description: safeString(data.description) } : {}),
          },
        });
        return {
          success: true,
          data: {
            id: event.id,
            start: event.startTime.toISOString(),
            end: event.endTime.toISOString(),
            startLocal: formatDateTimeForUser(
              event.startTime,
              resolvedTimeZone.timeZone,
            ),
            endLocal: formatDateTimeForUser(
              event.endTime,
              resolvedTimeZone.timeZone,
            ),
          },
          message: "Focus block created.",
          meta: { resource: "calendar", itemCount: 1 },
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't create a focus block right now.");
      }
    },

  };
}

export const __test__ = {
  computeConflictGroups,
};
