import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import prisma from "@/server/db/client";
import type { CalendarEventUpdateInput } from "@/features/calendar/event-types";
import { capabilityFailureResult } from "@/server/features/ai/tools/runtime/capabilities/errors";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findCalendarAvailability,
  getCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
} from "@/server/features/ai/tools/calendar/primitives";

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

function toDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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

function toEventListData(
  events: Array<{
    id: string;
    title: string;
    startTime: Date;
    endTime: Date;
    attendees: Array<{ email: string }>;
    location?: string;
    description?: string;
  }>,
): Array<Record<string, unknown>> {
  return events.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.startTime.toISOString(),
    end: event.endTime.toISOString(),
    attendees: event.attendees.map((attendee) => attendee.email),
    location: event.location ?? null,
    snippet: event.description ?? "",
  }));
}

function calendarFailure(error: unknown, message: string): ToolResult {
  return capabilityFailureResult(error, message, { resource: "calendar" });
}

export function createCalendarCapabilities(env: CapabilityEnvironment): CalendarCapabilities {
  const provider = env.toolContext.providers.calendar;

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
        const startRaw = (filter as Record<string, unknown>).start;
        const endRaw = (filter as Record<string, unknown>).end;
        const start = typeof startRaw === "string" ? new Date(startRaw) : undefined;
        const end = typeof endRaw === "string" ? new Date(endRaw) : undefined;

        const slots = await findCalendarAvailability(provider, {
          durationMinutes,
          ...(start && !Number.isNaN(start.getTime()) ? { start } : {}),
          ...(end && !Number.isNaN(end.getTime()) ? { end } : {}),
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
        const dateRange =
          filter && typeof filter.dateRange === "object"
            ? (filter.dateRange as Record<string, unknown>)
            : undefined;
        const start = toDate(dateRange?.after) ?? new Date();
        const end =
          toDate(dateRange?.before) ?? new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
        const query =
          safeString(filter.query) ??
          safeString(filter.text) ??
          safeString(filter.titleContains) ??
          "";
        const attendeeEmail = safeString(filter.attendeeEmail);

        const events = await listCalendarEvents(provider, {
          query,
          start,
          end,
          attendeeEmail,
        });
        const data = toEventListData(events);
        return {
          success: true,
          data,
          message:
            data.length === 0
              ? "No events found in that window."
              : `Found ${data.length} calendar event${data.length === 1 ? "" : "s"}.`,
          meta: { resource: "calendar", itemCount: data.length },
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't load calendar events right now.");
      }
    },

    async searchEventsByAttendee(filter) {
      try {
        const dateRange =
          filter && typeof filter.dateRange === "object"
            ? (filter.dateRange as Record<string, unknown>)
            : undefined;
        const start = toDate(dateRange?.after) ?? new Date();
        const end =
          toDate(dateRange?.before) ?? new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
        const query =
          safeString(filter.query) ??
          safeString(filter.text) ??
          safeString(filter.titleContains) ??
          "";
        const attendeeEmail =
          safeString(filter.attendeeEmail) ??
          safeString(filter.attendee) ??
          safeString(filter.email);

        const events = await listCalendarEvents(provider, {
          query,
          start,
          end,
          attendeeEmail,
        });
        const data = toEventListData(events);
        return {
          success: true,
          data,
          message:
            data.length === 0
              ? "No attendee-matching events found in that window."
              : `Found ${data.length} attendee-matching event${data.length === 1 ? "" : "s"}.`,
          meta: { resource: "calendar", itemCount: data.length },
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
      const start = toDate(data.start);
      const end = toDate(data.end);
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
            ...(safeString(data.timeZone) ? { timeZone: safeString(data.timeZone) } : {}),
          },
        });

        return {
          success: true,
          data: {
            id: event.id,
            title: event.title,
            start: event.startTime.toISOString(),
            end: event.endTime.toISOString(),
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

      try {
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
            ...(toDate((changes as Record<string, unknown>).start)
              ? { start: toDate((changes as Record<string, unknown>).start) }
              : {}),
            ...(toDate((changes as Record<string, unknown>).end)
              ? { end: toDate((changes as Record<string, unknown>).end) }
              : {}),
            ...(attendees.length > 0 ? { attendees } : {}),
            ...(safeString((changes as Record<string, unknown>).timeZone)
              ? { timeZone: safeString((changes as Record<string, unknown>).timeZone) }
              : {}),
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
        const current = await getCalendarEvent(provider, { eventId: targetEventId });
        if (!current) return { success: false, error: "event_not_found", message: "I couldn't find that event." };

        const explicitStart = toDate(changes.start);
        const explicitEnd = toDate(changes.end);
        const durationMs = Math.max(15 * 60 * 1000, current.endTime.getTime() - current.startTime.getTime());

        let start = explicitStart;
        let end = explicitEnd;

        if (!start || !end) {
          const strategyRaw = safeString(changes.rescheduleStrategy) ?? safeString(changes.reschedule) ?? "next_available";
          const strategy = strategyRaw.toLowerCase();
          const windowStart =
            toDate(changes.after) ??
            toDate(changes.windowStart) ??
            new Date(current.endTime.getTime() + 60 * 1000);
          const windowEnd =
            toDate(changes.before) ??
            toDate(changes.windowEnd) ??
            new Date(windowStart.getTime() + 14 * 24 * 60 * 60 * 1000);
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
      const start = toDate(data.start);
      const end = toDate(data.end);
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
            ...(safeString(data.location) ? { location: safeString(data.location) } : {}),
          },
        });
        return {
          success: true,
          data: { id: event.id, start: event.startTime.toISOString(), end: event.endTime.toISOString() },
          message: "Out-of-office event created.",
          meta: { resource: "calendar", itemCount: 1 },
        };
      } catch (error) {
        return calendarFailure(error, "I couldn't set out-of-office right now.");
      }
    },

    async createFocusBlock(data) {
      const start = toDate(data.start);
      const end = toDate(data.end);
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
            ...(safeString(data.description) ? { description: safeString(data.description) } : {}),
          },
        });
        return {
          success: true,
          data: { id: event.id, start: event.startTime.toISOString(), end: event.endTime.toISOString() },
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
