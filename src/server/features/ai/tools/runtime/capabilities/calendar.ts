import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import prisma from "@/server/db/client";
import type { CalendarEventUpdateInput } from "@/features/calendar/event-types";
import { capabilityFailureResult } from "@/server/features/ai/tools/runtime/capabilities/errors";
import {
  resolveCalendarTimeZoneForRequest,
  resolveDefaultCalendarTimeZone,
} from "@/server/features/ai/tools/calendar-time";
import {
  formatDateTimeForUser,
  parseDateBoundInTimeZone,
} from "@/server/features/ai/tools/timezone";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findCalendarAvailability,
  getCalendarEvent,
  updateCalendarEvent,
} from "@/server/features/ai/tools/calendar/primitives";
import { createUnifiedSearchService } from "@/server/features/search/unified/service";

export interface CalendarCapabilities {
  findAvailability(filter: Record<string, unknown>): Promise<ToolResult>;
  listEvents(filter: Record<string, unknown>): Promise<ToolResult>;
  searchEventsByAttendee(filter: Record<string, unknown>): Promise<ToolResult>;
  getEvent(input: { eventId: string; calendarId?: string }): Promise<ToolResult>;
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
  rescheduleEvent(eventIds: string[], changes: Record<string, unknown>): Promise<ToolResult>;
  setWorkingHours(changes: Record<string, unknown>): Promise<ToolResult>;
  setWorkingLocation(changes: Record<string, unknown>): Promise<ToolResult>;
  setOutOfOffice(data: Record<string, unknown>): Promise<ToolResult>;
  createFocusBlock(data: Record<string, unknown>): Promise<ToolResult>;
  createBookingSchedule(data: Record<string, unknown>): Promise<ToolResult>;
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

export function createCalendarCapabilities(env: CapabilityEnvironment): CalendarCapabilities {
  const provider = env.toolContext.providers.calendar;
  const unifiedSearch = createUnifiedSearchService({
    userId: env.runtime.userId,
    emailAccountId: env.runtime.emailAccountId,
    email: env.runtime.email,
    logger: env.runtime.logger,
    providers: env.toolContext.providers,
  });
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
              prompt: "I need a valid start datetime for availability checks.",
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
              prompt: "I need a valid end datetime for availability checks.",
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
        const result = await unifiedSearch.query({
          scopes: ["calendar"],
          query:
            safeString(filter.query) ??
            safeString(filter.titleContains),
          text: safeString(filter.text),
          attendeeEmail: safeString(filter.attendeeEmail),
          dateRange:
            filter.dateRange && typeof filter.dateRange === "object"
              ? {
                  after: safeString((filter.dateRange as Record<string, unknown>).after),
                  before: safeString((filter.dateRange as Record<string, unknown>).before),
                  timeZone:
                    safeString((filter.dateRange as Record<string, unknown>).timeZone) ??
                    safeString(filter.timeZone),
                }
              : undefined,
          limit:
            typeof filter.limit === "number" && Number.isFinite(filter.limit)
              ? Math.trunc(filter.limit)
              : undefined,
          fetchAll: typeof filter.fetchAll === "boolean" ? filter.fetchAll : undefined,
        });

        const data = result.items
          .filter((item) => item.surface === "calendar")
          .map((item) => {
            const metadata =
              item.metadata && typeof item.metadata === "object"
                ? (item.metadata as Record<string, unknown>)
                : {};

            return {
              id:
                typeof metadata.eventId === "string" ? metadata.eventId : item.id,
              title: item.title,
              start:
                typeof metadata.start === "string"
                  ? metadata.start
                  : item.timestamp ?? null,
              end: typeof metadata.end === "string" ? metadata.end : null,
              attendees: Array.isArray(metadata.attendees)
                ? metadata.attendees
                : [],
              location:
                typeof metadata.location === "string"
                  ? metadata.location
                  : null,
              snippet: item.snippet,
              score: item.score,
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

    async searchEventsByAttendee(filter) {
      try {
        const attendeeEmail =
          safeString(filter.attendeeEmail) ??
          safeString(filter.attendee) ??
          safeString(filter.email);

        const result = await unifiedSearch.query({
          scopes: ["calendar"],
          query:
            safeString(filter.query) ??
            safeString(filter.titleContains),
          text: safeString(filter.text),
          attendeeEmail,
          dateRange:
            filter.dateRange && typeof filter.dateRange === "object"
              ? {
                  after: safeString((filter.dateRange as Record<string, unknown>).after),
                  before: safeString((filter.dateRange as Record<string, unknown>).before),
                  timeZone:
                    safeString((filter.dateRange as Record<string, unknown>).timeZone) ??
                    safeString(filter.timeZone),
                }
              : undefined,
          limit:
            typeof filter.limit === "number" && Number.isFinite(filter.limit)
              ? Math.trunc(filter.limit)
              : undefined,
          fetchAll: typeof filter.fetchAll === "boolean" ? filter.fetchAll : undefined,
        });

        const data = result.items
          .filter((item) => item.surface === "calendar")
          .map((item) => {
            const metadata =
              item.metadata && typeof item.metadata === "object"
                ? (item.metadata as Record<string, unknown>)
                : {};

            return {
              id:
                typeof metadata.eventId === "string" ? metadata.eventId : item.id,
              title: item.title,
              start:
                typeof metadata.start === "string"
                  ? metadata.start
                  : item.timestamp ?? null,
              end: typeof metadata.end === "string" ? metadata.end : null,
              attendees: Array.isArray(metadata.attendees)
                ? metadata.attendees
                : [],
              location:
                typeof metadata.location === "string"
                  ? metadata.location
                  : null,
              snippet: item.snippet,
              score: item.score,
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
            prompt: "Which event should I inspect?",
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

    async createEvent(data) {
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
            prompt: "Please provide a valid IANA timezone, like America/Los_Angeles.",
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
            prompt: "I need a valid start and end time to create that event.",
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

    async updateEvent(input) {
      const eventId = safeString(input.eventId);
      if (!eventId) {
        return {
          success: false,
          error: "event_id_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "Which event should I update?",
            missingFields: ["event_id"],
          },
        };
      }

      const changes = input.changes ?? {};
      const attendees = toStringArray((changes as Record<string, unknown>).attendees);
      const modeRaw = safeString((changes as Record<string, unknown>).mode);
      const mode = modeRaw === "single" || modeRaw === "series" ? modeRaw : undefined;
      const requestedTimeZone = resolveRequestedTimeZone(changes as Record<string, unknown>);

      try {
        const resolvedTimeZone = await resolveEffectiveTimeZone(requestedTimeZone);
        if ("error" in resolvedTimeZone) {
          return {
            success: false,
            error: "invalid_time_zone",
            message: resolvedTimeZone.error,
            clarification: {
              kind: "invalid_fields",
              prompt: "Please provide a valid IANA timezone, like America/Los_Angeles.",
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
              prompt: "I need valid start/end date values for that update.",
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

    async deleteEvent(input) {
      const eventId = safeString(input.eventId);
      if (!eventId) {
        return {
          success: false,
          error: "event_id_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "Which event should I delete?",
            missingFields: ["event_id"],
          },
        };
      }
      const mode = input.mode === "single" || input.mode === "series" ? input.mode : "single";
      try {
        await deleteCalendarEvent(provider, {
          ...(safeString(input.calendarId)
            ? { calendarId: safeString(input.calendarId) }
            : {}),
          eventId,
          deleteOptions: { mode },
        });
        return {
          success: true,
          data: { eventId, mode },
          message: "Event deleted.",
          meta: { resource: "calendar", itemCount: 1 },
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't delete that event right now.");
      }
    },

    async manageAttendees(input) {
      const eventId = safeString(input.eventId);
      if (!eventId) {
        return {
          success: false,
          error: "event_id_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "Which event should I update attendees for?",
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
            prompt: "Who should be on this event?",
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
            prompt: "Which recurring event should I update?",
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

    async rescheduleEvent(eventIds, changes) {
      const targetEventId = eventIds.find((id) => id.trim().length > 0);
      if (!targetEventId) {
        return {
          success: false,
          error: "event_id_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "Which event should I reschedule?",
            missingFields: ["event_id"],
          },
        };
      }

      try {
        const requestedTimeZone = resolveRequestedTimeZone(changes as Record<string, unknown>);
        const resolvedTimeZone = await resolveEffectiveTimeZone(requestedTimeZone);
        if ("error" in resolvedTimeZone) {
          return {
            success: false,
            error: "invalid_time_zone",
            message: resolvedTimeZone.error,
            clarification: {
              kind: "invalid_fields",
              prompt: "Please provide a valid IANA timezone, like America/Los_Angeles.",
              missingFields: ["timeZone"],
            },
          };
        }

        const explicitStartRaw = safeString(changes.start);
        const explicitEndRaw = safeString(changes.end);
        const explicitStart =
          explicitStartRaw != null
            ? parseDateBoundInTimeZone(
                explicitStartRaw,
                resolvedTimeZone.timeZone,
                "start",
              )
            : undefined;
        const explicitEnd =
          explicitEndRaw != null
            ? parseDateBoundInTimeZone(explicitEndRaw, resolvedTimeZone.timeZone, "end")
            : undefined;

        if ((explicitStartRaw && !explicitStart) || (explicitEndRaw && !explicitEnd)) {
          return {
            success: false,
            error: "invalid_reschedule_window",
            message:
              "I need valid start/end values to reschedule. Use ISO-8601 or local datetime.",
          };
        }

        const current = await getCalendarEvent(provider, { eventId: targetEventId });
        if (!current) return { success: false, error: "event_not_found", message: "I couldn't find that event." };

        const durationMs = Math.max(15 * 60 * 1000, current.endTime.getTime() - current.startTime.getTime());

        let start = explicitStart;
        let end = explicitEnd;

        if (!start || !end) {
          const strategyRaw = safeString(changes.rescheduleStrategy) ?? safeString(changes.reschedule) ?? "next_available";
          const strategy = strategyRaw.toLowerCase();
          const windowStartRaw = safeString(changes.after) ?? safeString(changes.windowStart);
          const windowEndRaw = safeString(changes.before) ?? safeString(changes.windowEnd);
          const parsedWindowStart =
            windowStartRaw != null
              ? parseDateBoundInTimeZone(
                  windowStartRaw,
                  resolvedTimeZone.timeZone,
                  "start",
                )
              : undefined;
          const parsedWindowEnd =
            windowEndRaw != null
              ? parseDateBoundInTimeZone(windowEndRaw, resolvedTimeZone.timeZone, "end")
              : undefined;

          if ((windowStartRaw && !parsedWindowStart) || (windowEndRaw && !parsedWindowEnd)) {
            return {
              success: false,
              error: "invalid_reschedule_window",
              message:
                "I couldn't parse the reschedule window. Use ISO-8601 or local datetime values.",
            };
          }

          const windowStart = parsedWindowStart ?? new Date(current.endTime.getTime() + 60 * 1000);
          const windowEnd =
            parsedWindowEnd ??
            new Date(windowStart.getTime() + rescheduleWindowDurationMs);
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
          return { success: false, error: "invalid_reschedule_window", message: "I couldn't determine a valid new time." };
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
            previousStartLocal: formatDateTimeForUser(
              current.startTime,
              resolvedTimeZone.timeZone,
            ),
            previousEndLocal: formatDateTimeForUser(
              current.endTime,
              resolvedTimeZone.timeZone,
            ),
            newStartLocal: formatDateTimeForUser(
              updated.startTime,
              resolvedTimeZone.timeZone,
            ),
            newEndLocal: formatDateTimeForUser(
              updated.endTime,
              resolvedTimeZone.timeZone,
            ),
          },
          message: "Event rescheduled.",
          meta: { resource: "calendar", itemCount: 1 },
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
            prompt: "What working location should I set?",
            missingFields: ["working_location"],
          },
        };
      }

      // Placeholder until provider-specific working-location support is added.
      return {
        success: false,
        error: "unsupported_working_location",
        message:
          "Working location updates are not yet supported by this environment. I can create a calendar event note as a fallback.",
      };
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
            prompt: "Please provide a valid IANA timezone, like America/Los_Angeles.",
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
            prompt: "I need a valid out-of-office start and end time.",
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
            prompt: "Please provide a valid IANA timezone, like America/Los_Angeles.",
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
            prompt: "I need a valid focus-time start and end window.",
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

    async createBookingSchedule(data) {
      const bookingLink =
        typeof (data as Record<string, unknown>).bookingLink === "string"
          ? String((data as Record<string, unknown>).bookingLink)
          : typeof (data as Record<string, unknown>).booking_link === "string"
            ? String((data as Record<string, unknown>).booking_link)
            : null;

      if (!bookingLink || bookingLink.trim().length === 0) {
        return {
          success: false,
          error: "missing_booking_link",
          message: "I need a booking link to set up your booking page.",
          clarification: { kind: "missing_fields", prompt: "What is your booking link URL?", missingFields: ["booking_link"] },
        };
      }

      try {
        await prisma.emailAccount.update({
          where: { id: env.runtime.emailAccountId },
          data: { calendarBookingLink: bookingLink.trim() },
        });
        return {
          success: true,
          data: { bookingLink: bookingLink.trim() },
          message: "Booking link saved.",
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't save your booking link right now.");
      }
    },
  };
}
