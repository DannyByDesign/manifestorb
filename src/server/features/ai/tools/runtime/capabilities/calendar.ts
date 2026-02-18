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
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findCalendarAvailability,
  getCalendarEvent,
  updateCalendarEvent,
} from "@/server/features/ai/tools/calendar/primitives";
import { createUnifiedSearchService } from "@/server/features/search/unified/service";
import {
  ensureCalendarSelectionInvariant,
  isLikelyNoisyCalendar,
} from "@/server/features/calendar/selection-invariant";

export interface CalendarCapabilities {
  findAvailability(filter: Record<string, unknown>): Promise<ToolResult>;
  listEvents(filter: Record<string, unknown>): Promise<ToolResult>;
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
        dateRange?: { after: string; before: string; timeZone?: string };
        timeZone?: string;
      }
    | { errorResult: ToolResult }
  > => {
    const nestedDateRange =
      source.dateRange && typeof source.dateRange === "object"
        ? (source.dateRange as Record<string, unknown>)
        : undefined;
    const after = safeString(nestedDateRange?.after) ?? safeString(source.after);
    const before = safeString(nestedDateRange?.before) ?? safeString(source.before);
    const requestedTimeZone = resolveRequestedTimeZone(source, nestedDateRange);

    if (!after && !before) {
      return { dateRange: undefined, timeZone: requestedTimeZone };
    }

    const resolvedWindow = await resolveCalendarTimeRange({
      userId: env.runtime.userId,
      emailAccountId: env.runtime.emailAccountId,
      requestedTimeZone,
      dateRange: { after, before },
      relativeDateHintText: safeString(source.query) ?? safeString(source.text),
      defaultWindow: "next_7_days",
      missingBoundDurationMs: rescheduleWindowDurationMs,
    });

    if ("error" in resolvedWindow) {
      return {
        errorResult: {
          success: false,
          error: "invalid_event_window",
          message: resolvedWindow.error,
          clarification: {
            kind: "invalid_fields",
            prompt: "calendar_date_range_invalid",
            missingFields: ["dateRange.after", "dateRange.before"],
          },
        },
      };
    }

    return {
      dateRange: {
        after: resolvedWindow.start.toISOString(),
        before: resolvedWindow.end.toISOString(),
        timeZone: resolvedWindow.timeZone,
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

        const result = await unifiedSearch.query({
          scopes: ["calendar"],
          query:
            safeString(filterRecord.query) ??
            safeString(filterRecord.titleContains),
          text: safeString(filterRecord.text),
          attendeeEmail: safeString(filterRecord.attendeeEmail),
          calendarIds: calendarIds.length > 0 ? calendarIds : undefined,
          locationContains:
            safeString(filterRecord.locationContains) ??
            safeString(filterRecord.location) ??
            undefined,
          dateRange: resolvedDateRange.dateRange,
          limit:
            typeof filterRecord.limit === "number" && Number.isFinite(filterRecord.limit)
              ? Math.trunc(filterRecord.limit)
              : undefined,
          fetchAll:
            typeof filterRecord.fetchAll === "boolean"
              ? filterRecord.fetchAll
              : undefined,
        });

        const data = result.items
          .filter((item) => item.surface === "calendar")
          .map((item) => {
            const metadata =
              item.metadata && typeof item.metadata === "object"
                ? (item.metadata as Record<string, unknown>)
                : {};
            const start =
              typeof metadata.start === "string"
                ? metadata.start
                : item.timestamp ?? null;
            const end = typeof metadata.end === "string" ? metadata.end : null;
            const eventTimeZone =
              safeString(metadata.timeZone) ??
              safeString(metadata.timezone) ??
              resolvedDateRange.timeZone ??
              safeString(filterRecord.timeZone);

            return {
              id:
                typeof metadata.eventId === "string" ? metadata.eventId : item.id,
              title: item.title,
              start,
              end,
              startLocal: formatLocalTimestamp(start, eventTimeZone),
              endLocal: formatLocalTimestamp(end, eventTimeZone),
              attendees: Array.isArray(metadata.attendees)
                ? metadata.attendees
                : [],
              organizerEmail:
                typeof metadata.authorIdentity === "string"
                  ? metadata.authorIdentity
                  : null,
              calendarId:
                typeof metadata.calendarId === "string" ? metadata.calendarId : null,
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
        const filterRecord = filter as Record<string, unknown>;
        const resolvedDateRange = await resolveUnifiedCalendarDateRange(filterRecord);
        if ("errorResult" in resolvedDateRange) return resolvedDateRange.errorResult;

        const attendeeEmail =
          safeString(filterRecord.attendeeEmail) ??
          safeString(filterRecord.attendee) ??
          safeString(filterRecord.email);

        const result = await unifiedSearch.query({
          scopes: ["calendar"],
          query:
            safeString(filterRecord.query) ??
            safeString(filterRecord.titleContains),
          text: safeString(filterRecord.text),
          attendeeEmail,
          calendarIds: (() => {
            const ids = Array.from(
              new Set([
                ...toStringArray(filterRecord.calendarIds),
                ...(safeString(filterRecord.calendarId) ? [safeString(filterRecord.calendarId)!] : []),
              ]),
            ).filter(Boolean);
            return ids.length > 0 ? ids : undefined;
          })(),
          locationContains:
            safeString(filterRecord.locationContains) ??
            safeString(filterRecord.location) ??
            undefined,
          dateRange: resolvedDateRange.dateRange,
          limit:
            typeof filterRecord.limit === "number" && Number.isFinite(filterRecord.limit)
              ? Math.trunc(filterRecord.limit)
              : undefined,
          fetchAll:
            typeof filterRecord.fetchAll === "boolean"
              ? filterRecord.fetchAll
              : undefined,
        });

        const data = result.items
          .filter((item) => item.surface === "calendar")
          .map((item) => {
            const metadata =
              item.metadata && typeof item.metadata === "object"
                ? (item.metadata as Record<string, unknown>)
                : {};
            const start =
              typeof metadata.start === "string"
                ? metadata.start
                : item.timestamp ?? null;
            const end = typeof metadata.end === "string" ? metadata.end : null;
            const eventTimeZone =
              safeString(metadata.timeZone) ??
              safeString(metadata.timezone) ??
              resolvedDateRange.timeZone ??
              safeString(filterRecord.timeZone);

            return {
              id:
                typeof metadata.eventId === "string" ? metadata.eventId : item.id,
              title: item.title,
              start,
              end,
              startLocal: formatLocalTimestamp(start, eventTimeZone),
              endLocal: formatLocalTimestamp(end, eventTimeZone),
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
            prompt: "calendar_event_id_required",
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

        const results = await unifiedSearch.query({
          scopes: ["calendar"],
          query: query ?? undefined,
          attendeeEmail,
          calendarIds: calendarIds.length > 0 ? calendarIds : undefined,
          dateRange: {
            ...(safeString(dateRange.after) ? { after: safeString(dateRange.after) } : {}),
            ...(safeString(dateRange.before) ? { before: safeString(dateRange.before) } : {}),
            ...(safeString(dateRange.timeZone) ? { timeZone: safeString(dateRange.timeZone) } : {}),
          },
          limit,
        });

        const candidates = results.items
          .filter((item) => item.surface === "calendar")
          .map((item) => {
            const metadata =
              item.metadata && typeof item.metadata === "object"
                ? (item.metadata as Record<string, unknown>)
                : {};
            const eventId =
              typeof metadata.eventId === "string"
                ? metadata.eventId
                : typeof metadata.sourceId === "string"
                  ? metadata.sourceId
                  : item.id.includes(":")
                    ? item.id.split(":").slice(1).join(":")
                    : item.id;
            return {
              eventId,
              title: item.title,
              start: typeof metadata.start === "string" ? metadata.start : item.timestamp ?? null,
              end: typeof metadata.end === "string" ? metadata.end : null,
              organizerEmail: typeof metadata.authorIdentity === "string" ? metadata.authorIdentity : null,
            };
          });

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

      const startRaw =
        safeString(changes.start) ??
        safeString(changes.date) ??
        (env.toolContext.currentMessage?.toLowerCase().includes("tomorrow")
          ? "tomorrow"
          : env.toolContext.currentMessage?.toLowerCase().includes("today")
            ? "today"
            : undefined);
      const endRaw =
        safeString(changes.end) ??
        safeString(changes.date) ??
        (startRaw ? startRaw : undefined);

      const start = parseDateBoundInTimeZone(startRaw, resolvedTimeZone.timeZone, "start");
      const end = parseDateBoundInTimeZone(endRaw, resolvedTimeZone.timeZone, "end");
      if (!start || !end || start.getTime() >= end.getTime()) {
        return {
          success: false,
          error: "invalid_working_location_window",
          clarification: {
            kind: "missing_fields",
            prompt: "calendar_working_location_time_invalid",
            missingFields: ["date_or_window"],
          },
        };
      }

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

    async createBookingSchedule(data) {
      const bookingLink =
        typeof (data as Record<string, unknown>).bookingLink === "string"
          ? String((data as Record<string, unknown>).bookingLink)
          : typeof (data as Record<string, unknown>).booking_link === "string"
            ? String((data as Record<string, unknown>).booking_link)
            : null;

      try {
        const durationMinutesRaw =
          typeof (data as Record<string, unknown>).durationMinutes === "number"
            ? (data as Record<string, unknown>).durationMinutes
            : typeof (data as Record<string, unknown>).meetingDurationMin === "number"
              ? (data as Record<string, unknown>).meetingDurationMin
              : undefined;
        const durationMinutes =
          typeof durationMinutesRaw === "number" && Number.isFinite(durationMinutesRaw)
            ? Math.max(5, Math.min(240, Math.trunc(durationMinutesRaw)))
            : undefined;
        const slotCountRaw =
          typeof (data as Record<string, unknown>).slotCount === "number"
            ? (data as Record<string, unknown>).slotCount
            : undefined;
        const slotCount =
          typeof slotCountRaw === "number" && Number.isFinite(slotCountRaw)
            ? Math.max(1, Math.min(10, Math.trunc(slotCountRaw)))
            : undefined;

        const timeZone = safeString((data as Record<string, unknown>).timeZone);

        const [accountUpdated, prefUpdated] = await prisma.$transaction([
          bookingLink && bookingLink.trim().length > 0
            ? prisma.emailAccount.update({
                where: { id: env.runtime.emailAccountId },
                data: { calendarBookingLink: bookingLink.trim() },
              })
            : prisma.emailAccount.findUniqueOrThrow({
                where: { id: env.runtime.emailAccountId },
              }),
          prisma.taskPreference.upsert({
            where: { userId: env.runtime.userId },
            create: {
              userId: env.runtime.userId,
              ...(durationMinutes !== undefined ? { defaultMeetingDurationMin: durationMinutes } : {}),
              ...(slotCount !== undefined ? { meetingSlotCount: slotCount } : {}),
              ...(timeZone ? { timeZone } : {}),
            },
            update: {
              ...(durationMinutes !== undefined ? { defaultMeetingDurationMin: durationMinutes } : {}),
              ...(slotCount !== undefined ? { meetingSlotCount: slotCount } : {}),
              ...(timeZone ? { timeZone } : {}),
            },
          }),
        ]);
        return {
          success: true,
          data: {
            calendarBookingLink: accountUpdated.calendarBookingLink ?? null,
            defaultMeetingDurationMin: prefUpdated.defaultMeetingDurationMin,
            meetingSlotCount: prefUpdated.meetingSlotCount,
            timeZone: prefUpdated.timeZone,
          },
          message:
            bookingLink && bookingLink.trim().length > 0
              ? "Booking link and meeting slot preferences saved."
              : "Meeting slot preferences saved. If you have a booking link, you can also provide it to save it.",
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't save your booking link right now.");
      }
    },
  };
}
