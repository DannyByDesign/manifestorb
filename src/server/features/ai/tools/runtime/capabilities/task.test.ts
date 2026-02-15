import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createTaskCapabilities } from "@/server/features/ai/tools/runtime/capabilities/task";
import {
  createCalendarEvent,
  findCalendarAvailability,
  listCalendarEvents,
  updateCalendarEvent,
} from "@/server/features/ai/tools/calendar/primitives";
import {
  resolveCalendarTimeZoneForRequest,
  resolveDefaultCalendarTimeZone,
} from "@/server/features/ai/tools/calendar-time";

vi.mock("@/server/db/client", () => ({
  default: {
    task: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    taskSchedule: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/server/features/ai/tools/calendar-time", () => ({
  resolveDefaultCalendarTimeZone: vi.fn(),
  resolveCalendarTimeZoneForRequest: vi.fn(),
}));

vi.mock("@/server/features/ai/tools/calendar/primitives", () => ({
  createCalendarEvent: vi.fn(),
  findCalendarAvailability: vi.fn(),
  listCalendarEvents: vi.fn(),
  updateCalendarEvent: vi.fn(),
}));

function buildEnv(): CapabilityEnvironment {
  return {
    runtime: {
      userId: "user-1",
      emailAccountId: "email-1",
      email: "user@example.com",
      provider: "slack",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      },
    },
    toolContext: {
      userId: "user-1",
      emailAccountId: "email-1",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      },
      providers: {
        calendar: {} as never,
        email: {} as never,
      },
    },
  };
}

type PrismaTaskMock = {
  task: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  taskSchedule: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

describe("runtime task capabilities", () => {
  beforeEach(async () => {
    vi.resetAllMocks();

    const prisma = (await import("@/server/db/client"))
      .default as unknown as PrismaTaskMock;
    prisma.task.findFirst.mockResolvedValue({
      id: "task-1",
      title: "Scaffold portfolio",
      durationMinutes: 120,
      scheduledStart: new Date("2026-02-16T17:00:00.000Z"),
      scheduledEnd: new Date("2026-02-16T19:00:00.000Z"),
    });
    prisma.task.update.mockResolvedValue({ id: "task-1" });
    prisma.taskSchedule.findUnique.mockResolvedValue({
      calendarId: "primary",
      calendarEventId: "evt-1",
    });
    prisma.taskSchedule.upsert.mockResolvedValue({ id: "sched-1" });

    vi.mocked(resolveDefaultCalendarTimeZone).mockResolvedValue({
      timeZone: "America/Los_Angeles",
      source: "integration",
    });
    vi.mocked(resolveCalendarTimeZoneForRequest).mockImplementation(
      ({ requestedTimeZone, defaultTimeZone }) => ({
        timeZone: requestedTimeZone ?? defaultTimeZone,
      }),
    );

    vi.mocked(updateCalendarEvent).mockResolvedValue({
      id: "evt-1",
      calendarId: "primary",
      title: "Scaffold portfolio",
      startTime: new Date("2026-02-18T18:00:00.000Z"),
      endTime: new Date("2026-02-18T20:00:00.000Z"),
      attendees: [],
    } as never);
    vi.mocked(findCalendarAvailability).mockResolvedValue([]);
    vi.mocked(listCalendarEvents).mockResolvedValue([]);
    vi.mocked(createCalendarEvent).mockResolvedValue({
      id: "evt-created",
      calendarId: "primary",
      title: "Scaffold portfolio",
      startTime: new Date("2026-02-18T18:00:00.000Z"),
      endTime: new Date("2026-02-18T20:00:00.000Z"),
      attendees: [],
    } as never);
  });

  it("reschedules task and updates linked calendar event", async () => {
    const caps = createTaskCapabilities(buildEnv());

    const result = await caps.reschedule({
      taskId: "task-1",
      changes: {
        start: "2026-02-18T10:00",
        end: "2026-02-18T12:00",
      },
    });

    expect(result.success).toBe(true);
    expect(vi.mocked(updateCalendarEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        calendarId: "primary",
        eventId: "evt-1",
      }),
    );

    const prisma = (await import("@/server/db/client"))
      .default as unknown as PrismaTaskMock;
    expect(prisma.taskSchedule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "task-1" },
        update: expect.objectContaining({
          calendarId: "primary",
          calendarEventId: "evt-1",
        }),
      }),
    );
  });

  it("asks for task identity when missing", async () => {
    const caps = createTaskCapabilities(buildEnv());

    const result = await caps.reschedule({ changes: {} });

    expect(result.success).toBe(false);
    expect(result.error).toBe("task_missing");
    expect(result.clarification?.kind).toBe("missing_fields");
  });
});
