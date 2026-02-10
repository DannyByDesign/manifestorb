import { describe, it, expect, vi } from "vitest";
import { createCalendarProvider } from "./calendar";
import type { Logger } from "@/server/lib/logger";

const findAvailableSlotsMock = vi.fn().mockResolvedValue([
  {
    start: new Date("2026-02-13T18:00:00.000Z"),
    end: new Date("2026-02-13T18:30:00.000Z"),
    score: 0.91,
  },
]);

vi.mock("@/features/calendar/event-provider", () => ({
  createCalendarEventProviders: vi.fn().mockResolvedValue([
    {
      provider: "google" as const,
      fetchEvents: vi.fn(),
      fetchEventsWithAttendee: vi.fn(),
      getEvent: vi.fn(),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
    },
  ]),
}));

vi.mock("@/features/calendar/scheduling/CalendarServiceImpl", () => ({
  CalendarServiceImpl: class CalendarServiceImplMock {},
}));

vi.mock("@/features/calendar/scheduling/TimeSlotManager", () => ({
  TimeSlotManagerImpl: class TimeSlotManagerImplMock {
    findAvailableSlots = findAvailableSlotsMock;
  },
}));

vi.mock("@/features/ai/tools/calendar-time", () => ({
  resolveDefaultCalendarTimeZone: vi.fn().mockResolvedValue({
    timeZone: "America/Los_Angeles",
  }),
}));

vi.mock("@/server/db/client", () => ({
  default: {
    calendar: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    taskPreference: {
      findUnique: vi.fn(),
    },
  },
}));

describe("createCalendarProvider", () => {
  it("throws when calendarId does not belong to account", async () => {
    const prisma = (await import("@/server/db/client")).default as unknown as {
      calendar: { findFirst: ReturnType<typeof vi.fn> };
    };
    prisma.calendar.findFirst.mockResolvedValue(null);

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      with: vi.fn().mockReturnThis(),
    } as unknown as Logger;

    const provider = await createCalendarProvider(
      { id: "email-account-1" },
      "user-1",
      logger,
    );

    await expect(
      provider.getEvent({ eventId: "evt-1", calendarId: "calendar-1" }),
    ).rejects.toThrow("Calendar not found for account");
  });

  it("uses provider attendee search when attendeeEmail is supplied", async () => {
    const eventProviderModule = await import("@/features/calendar/event-provider");
    const fetchEventsWithAttendee = vi.fn().mockResolvedValue([
      {
        id: "evt-1",
        title: "1:1",
        startTime: new Date("2026-02-09T10:00:00.000Z"),
        endTime: new Date("2026-02-09T10:30:00.000Z"),
        attendees: [{ email: "target@example.com" }],
      },
    ]);
    const createProvidersMock = vi.mocked(eventProviderModule.createCalendarEventProviders);
    createProvidersMock.mockResolvedValueOnce([
      {
        provider: "google",
        fetchEvents: vi.fn(),
        fetchEventsWithAttendee,
        getEvent: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      },
    ]);

    const prisma = (await import("@/server/db/client")).default as unknown as {
      taskPreference: { findUnique: ReturnType<typeof vi.fn> };
    };
    prisma.taskPreference.findUnique.mockResolvedValueOnce({ selectedCalendarIds: [] });

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      with: vi.fn().mockReturnThis(),
    } as unknown as Logger;

    const provider = await createCalendarProvider(
      { id: "email-account-1" },
      "user-1",
      logger,
    );

    const events = await provider.searchEvents(
      "",
      { start: new Date("2026-02-09T00:00:00.000Z"), end: new Date("2026-02-10T00:00:00.000Z") },
      "target@example.com",
    );

    expect(fetchEventsWithAttendee).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
  });

  it("uses all enabled calendars when selectedCalendarIds is empty for availability lookup", async () => {
    const prisma = (await import("@/server/db/client")).default as unknown as {
      taskPreference: { findUnique: ReturnType<typeof vi.fn> };
      calendar: { findMany: ReturnType<typeof vi.fn> };
    };
    prisma.taskPreference.findUnique.mockResolvedValueOnce({
      selectedCalendarIds: [],
      workHourStart: 9,
      workHourEnd: 17,
      workDays: [1, 2, 3, 4, 5],
      bufferMinutes: 15,
      groupByProject: false,
    });
    prisma.calendar.findMany.mockResolvedValueOnce([{ calendarId: "primary" }]);

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      with: vi.fn().mockReturnThis(),
    } as unknown as Logger;

    const provider = await createCalendarProvider(
      { id: "email-account-1" },
      "user-1",
      logger,
    );

    const slots = await provider.findAvailableSlots({
      durationMinutes: 30,
      start: new Date("2026-02-13T00:00:00.000Z"),
      end: new Date("2026-02-14T00:00:00.000Z"),
    });

    expect(prisma.calendar.findMany).toHaveBeenCalled();
    expect(slots).toHaveLength(1);
    expect(slots[0]?.score).toBe(0.91);
  });
});
