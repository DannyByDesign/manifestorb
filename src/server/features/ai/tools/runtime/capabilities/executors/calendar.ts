import type { RuntimeToolExecutorMap } from "@/server/features/ai/tools/runtime/capabilities/executors/types";
import {
  asObject,
  asString,
  asStringArray,
} from "@/server/features/ai/tools/runtime/capabilities/executors/utils";

export const calendarToolExecutors: RuntimeToolExecutorMap = {
  "calendar.findAvailability": async ({ args, capabilities }) =>
    capabilities.calendar.findAvailability(asObject(args)),
  "calendar.listEvents": async ({ args, capabilities }) =>
    capabilities.calendar.listEvents(asObject(args)),
  "calendar.detectConflicts": async ({ args, capabilities }) =>
    capabilities.calendar.detectConflicts(asObject(args)),
  "calendar.searchEventsByAttendee": async ({ args, capabilities }) =>
    capabilities.calendar.searchEventsByAttendee(asObject(args)),
  "calendar.getEvent": async ({ args, capabilities }) =>
    capabilities.calendar.getEvent({
      eventId: asString(args.eventId) ?? "",
      calendarId: asString(args.calendarId),
    }),
  "calendar.listCalendars": async ({ capabilities }) =>
    capabilities.calendar.listCalendars(),
  "calendar.setEnabledCalendars": async ({ args, capabilities }) =>
    capabilities.calendar.setEnabledCalendars(asObject(args)),
  "calendar.setSelectedCalendars": async ({ args, capabilities }) =>
    capabilities.calendar.setSelectedCalendars(asObject(args)),
  "calendar.createEvent": async ({ args, capabilities }) =>
    capabilities.calendar.createEvent(asObject(args)),
  "calendar.updateEvent": async ({ args, capabilities }) =>
    capabilities.calendar.updateEvent({
      eventId: asString(args.eventId) ?? "",
      calendarId: asString(args.calendarId),
      changes: asObject(args.changes),
    }),
  "calendar.deleteEvent": async ({ args, capabilities }) =>
    capabilities.calendar.deleteEvent({
      eventId: asString(args.eventId) ?? "",
      calendarId: asString(args.calendarId),
      mode:
        args.mode === "single" || args.mode === "series" ? args.mode : undefined,
    }),
  "calendar.manageAttendees": async ({ args, capabilities }) =>
    capabilities.calendar.manageAttendees({
      eventId: asString(args.eventId) ?? "",
      calendarId: asString(args.calendarId),
      attendees: asStringArray(args.attendees),
      mode:
        args.mode === "single" || args.mode === "series" ? args.mode : undefined,
    }),
  "calendar.updateRecurringMode": async ({ args, capabilities }) =>
    capabilities.calendar.updateRecurringMode({
      eventId: asString(args.eventId) ?? "",
      calendarId: asString(args.calendarId),
      mode: args.mode === "single" || args.mode === "series" ? args.mode : "single",
      changes: args.changes ? asObject(args.changes) : undefined,
    }),
  "calendar.rescheduleEvent": async ({ args, capabilities }) =>
    capabilities.calendar.rescheduleEvent({
      eventIds: asStringArray(args.eventIds),
      filter: args.filter ? asObject(args.filter) : undefined,
      changes: args.changes ? asObject(args.changes) : undefined,
    }),
  "calendar.setWorkingHours": async ({ args, capabilities }) =>
    capabilities.calendar.setWorkingHours(asObject(args)),
  "calendar.setWorkingLocation": async ({ args, capabilities }) =>
    capabilities.calendar.setWorkingLocation(asObject(args)),
  "calendar.setOutOfOffice": async ({ args, capabilities }) =>
    capabilities.calendar.setOutOfOffice(asObject(args)),
  "calendar.createFocusBlock": async ({ args, capabilities }) =>
    capabilities.calendar.createFocusBlock(asObject(args)),
  "calendar.createBookingSchedule": async ({ args, capabilities }) =>
    capabilities.calendar.createBookingSchedule(asObject(args)),
};
