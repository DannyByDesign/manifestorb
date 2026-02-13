import type { CalendarProvider } from "@/server/features/ai/tools/providers/calendar";
import type {
  CalendarEventCreateInput,
  CalendarEventDeleteOptions,
  CalendarEventUpdateInput,
} from "@/features/calendar/event-types";

export async function listCalendarEvents(
  provider: CalendarProvider,
  input: {
    query: string;
    start: Date;
    end: Date;
    attendeeEmail?: string;
  },
) {
  return provider.searchEvents(input.query, { start: input.start, end: input.end }, input.attendeeEmail);
}

export async function findCalendarAvailability(
  provider: CalendarProvider,
  input: {
    durationMinutes: number;
    start?: Date;
    end?: Date;
  },
) {
  return provider.findAvailableSlots(input);
}

export async function getCalendarEvent(
  provider: CalendarProvider,
  input: {
    eventId: string;
    calendarId?: string;
  },
) {
  return provider.getEvent(input);
}

export async function createCalendarEvent(
  provider: CalendarProvider,
  input: {
    calendarId?: string;
    event: CalendarEventCreateInput;
  },
) {
  return provider.createEvent({
    calendarId: input.calendarId,
    input: input.event,
  });
}

export async function updateCalendarEvent(
  provider: CalendarProvider,
  input: {
    calendarId?: string;
    eventId: string;
    event: CalendarEventUpdateInput;
  },
) {
  return provider.updateEvent({
    calendarId: input.calendarId,
    eventId: input.eventId,
    input: input.event,
  });
}

export async function deleteCalendarEvent(
  provider: CalendarProvider,
  input: {
    calendarId?: string;
    eventId: string;
    deleteOptions?: CalendarEventDeleteOptions;
  },
) {
  return provider.deleteEvent({
    calendarId: input.calendarId,
    eventId: input.eventId,
    deleteOptions: input.deleteOptions,
  });
}
