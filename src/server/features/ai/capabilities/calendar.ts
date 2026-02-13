import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/capabilities/types";
import prisma from "@/server/db/client";
import type { CalendarEventUpdateInput } from "@/features/calendar/event-types";

export interface CalendarCapabilities {
  findAvailability(filter: Record<string, unknown>): Promise<ToolResult>;
  listEvents(filter: Record<string, unknown>): Promise<ToolResult>;
  createEvent(data: Record<string, unknown>): Promise<ToolResult>;
  rescheduleEvent(eventIds: string[], changes: Record<string, unknown>): Promise<ToolResult>;
  setWorkingHours(changes: Record<string, unknown>): Promise<ToolResult>;
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

        const slots = await provider.findAvailableSlots({
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
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: message,
          message: "I couldn't compute availability right now.",
        };
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

        const events = await provider.searchEvents(query, { start, end }, attendeeEmail);
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
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message: "I couldn't load calendar events right now." };
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
        const event = await provider.createEvent({
          input: {
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
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message: "I couldn't create that event right now." };
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
        const current = await provider.getEvent({ eventId: targetEventId });
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
          const slots = await provider.findAvailableSlots({
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
        const updated = await provider.updateEvent({
          eventId: targetEventId,
          input: updateInput,
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
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message: "I couldn't reschedule that event right now." };
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
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message: "I couldn't update working hours right now." };
      }
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
        const event = await provider.createEvent({
          input: {
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
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message: "I couldn't set out-of-office right now." };
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
        const event = await provider.createEvent({
          input: {
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
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message: "I couldn't create a focus block right now." };
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
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message: "I couldn't save your booking link right now." };
      }
    },
  };
}
