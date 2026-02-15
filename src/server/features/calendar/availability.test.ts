import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimeSlotManagerImpl } from "@/server/features/calendar/scheduling/TimeSlotManager";
import type { CalendarService } from "@/server/features/calendar/scheduling/CalendarService";
import type {
  SchedulingSettings,
  SchedulingTask,
} from "@/server/features/calendar/scheduling/types";
import prisma from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");

const buildSettings = (): SchedulingSettings => ({
  workHourStart: 9,
  workHourEnd: 17,
  workDays: [1, 2, 3, 4, 5],
  bufferMinutes: 15,
  selectedCalendarIds: ["cal-1", "cal-2"],
  timeZone: "UTC",
  groupByProject: false,
});

const buildTask = (): SchedulingTask => ({
  id: "task-1",
  userId: "user-1",
  title: "Focus work",
  durationMinutes: 30,
  status: "PENDING",
});

describe("TimeSlotManager availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.task.findMany.mockResolvedValue([] as unknown as object[]);
  });

  it("returns slots within working hours", async () => {
    const calendarService: CalendarService = {
      findConflicts: vi.fn().mockResolvedValue([]),
      findBatchConflicts: vi.fn().mockImplementation((slots: any[]) =>
        slots.map((entry) => ({ ...entry, conflicts: [] })),
      ),
    };

    const manager = new TimeSlotManagerImpl(buildSettings(), calendarService);
    const slots = await manager.findAvailableSlots(
      buildTask(),
      new Date("2024-05-06T08:00:00.000Z"),
      new Date("2024-05-06T12:00:00.000Z"),
    );

    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((slot) => slot.isWithinWorkHours)).toBe(true);
  });

  it("flags buffer availability on slots", async () => {
    const calendarService: CalendarService = {
      findConflicts: vi.fn().mockResolvedValue([]),
      findBatchConflicts: vi.fn().mockImplementation((slots: any[]) =>
        slots.map((entry) => ({ ...entry, conflicts: [] })),
      ),
    };

    const manager = new TimeSlotManagerImpl(buildSettings(), calendarService);
    const slots = await manager.findAvailableSlots(
      buildTask(),
      new Date("2024-05-06T08:00:00.000Z"),
      new Date("2024-05-06T12:00:00.000Z"),
    );

    expect(slots.some((slot) => slot.hasBufferTime)).toBe(true);
  });

  it("checks calendar conflicts even when no calendar ids are selected", async () => {
    const calendarService: CalendarService = {
      findConflicts: vi.fn().mockResolvedValue([
        {
          type: "calendar_event",
          title: "Busy",
          start: new Date("2024-05-06T09:00:00.000Z"),
          end: new Date("2024-05-06T09:30:00.000Z"),
          source: { type: "calendar", id: "evt-1" },
        },
      ]),
      findBatchConflicts: vi.fn().mockResolvedValue([]),
    };

    const manager = new TimeSlotManagerImpl(
      { ...buildSettings(), selectedCalendarIds: [] },
      calendarService,
    );

    const isAvailable = await manager.isSlotAvailable(
      {
        start: new Date("2024-05-06T09:00:00.000Z"),
        end: new Date("2024-05-06T09:30:00.000Z"),
        score: 0,
        conflicts: [],
        energyLevel: null,
        isWithinWorkHours: true,
        hasBufferTime: false,
      },
      "user-1",
    );

    expect(isAvailable).toBe(false);
    expect(calendarService.findConflicts).toHaveBeenCalledWith(
      expect.objectContaining({
        start: new Date("2024-05-06T09:00:00.000Z"),
        end: new Date("2024-05-06T09:30:00.000Z"),
      }),
      [],
      "user-1",
    );
  });
});
