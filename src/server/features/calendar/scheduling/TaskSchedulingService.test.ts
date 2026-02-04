import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveSchedulingEmailAccountId, scheduleTasksForUser } from "./TaskSchedulingService";

const mockLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  with: vi.fn().mockReturnThis(),
};

vi.mock("@/server/db/client", () => ({
  default: {
    calendar: {
      findMany: vi.fn(),
    },
    taskPreference: {
      update: vi.fn(),
    },
    emailAccount: {
      findFirst: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED: true,
  },
}));

vi.mock("./SchedulingService", () => ({
  SchedulingService: class {
    constructor() {}
    scheduleMultipleTasks = vi.fn().mockResolvedValue([]);
  },
}));

describe("resolveSchedulingEmailAccountId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns provided emailAccountId", async () => {
    const result = await resolveSchedulingEmailAccountId({
      userId: "user-1",
      emailAccountId: "email-123",
      selectedCalendarIds: ["cal-1"],
      logger: mockLogger as any,
    });

    expect(result).toBe("email-123");
  });

  it("resolves from selected calendars", async () => {
    const prisma = (await import("@/server/db/client")).default as any;
    prisma.calendar.findMany.mockResolvedValue([
      {
        calendarId: "cal-1",
        connection: { emailAccountId: "email-abc" },
      },
    ]);

    const result = await resolveSchedulingEmailAccountId({
      userId: "user-1",
      selectedCalendarIds: ["cal-1"],
      logger: mockLogger as any,
    });

    expect(result).toBe("email-abc");
  });

  it("warns and chooses deterministic account when multiple accounts are selected", async () => {
    const prisma = (await import("@/server/db/client")).default as any;
    prisma.calendar.findMany.mockResolvedValue([
      {
        calendarId: "cal-1",
        connection: { emailAccountId: "email-1" },
      },
      {
        calendarId: "cal-2",
        connection: { emailAccountId: "email-2" },
      },
    ]);
    prisma.emailAccount.findFirst.mockResolvedValue({ id: "email-1" });

    const result = await resolveSchedulingEmailAccountId({
      userId: "user-1",
      selectedCalendarIds: ["cal-1", "cal-2"],
      logger: mockLogger as any,
    });

    expect(result).toBe("email-1");
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("removes invalid selected calendar IDs and falls back", async () => {
    const prisma = (await import("@/server/db/client")).default as any;
    prisma.calendar.findMany.mockResolvedValue([]);
    prisma.emailAccount.findFirst.mockResolvedValue({ id: "email-fallback" });

    const result = await resolveSchedulingEmailAccountId({
      userId: "user-1",
      selectedCalendarIds: ["cal-missing"],
      logger: mockLogger as any,
    });

    expect(prisma.taskPreference.update).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { selectedCalendarIds: [] },
    });
    expect(result).toBe("email-fallback");
  });

  it("falls back to first email account when no calendars selected", async () => {
    const prisma = (await import("@/server/db/client")).default as any;
    prisma.emailAccount.findFirst.mockResolvedValue({ id: "email-fallback" });

    const result = await resolveSchedulingEmailAccountId({
      userId: "user-1",
      selectedCalendarIds: [],
      logger: mockLogger as any,
    });

    expect(result).toBe("email-fallback");
  });
});

describe("scheduleTasksForUser feature flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty when scheduling is disabled", async () => {
    const { env } = await import("@/env");
    (env as any).NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED = false;

    const result = await scheduleTasksForUser({ userId: "user-1", source: "manual" });
    expect(result).toEqual([]);
  });

  it("runs when scheduling is enabled", async () => {
    const { env } = await import("@/env");
    (env as any).NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED = true;

    const prisma = (await import("@/server/db/client")).default as any;
    prisma.taskPreference.findUnique = vi.fn().mockResolvedValue({
      userId: "user-1",
      workHourStart: 9,
      workHourEnd: 17,
      workDays: [1, 2, 3, 4, 5],
      bufferMinutes: 10,
      selectedCalendarIds: [],
      timeZone: "UTC",
      groupByProject: false,
    });
    prisma.taskPreference.create = vi.fn().mockResolvedValue({
      userId: "user-1",
      workHourStart: 9,
      workHourEnd: 17,
      workDays: [1, 2, 3, 4, 5],
      bufferMinutes: 10,
      selectedCalendarIds: [],
      timeZone: "UTC",
      groupByProject: false,
    });
    prisma.task.findMany = vi.fn().mockResolvedValue([]);
    prisma.task.updateMany = vi.fn().mockResolvedValue({ count: 0 });
    prisma.emailAccount.findFirst = vi.fn().mockResolvedValue({ id: "email-1" });

    const result = await scheduleTasksForUser({ userId: "user-1", source: "manual" });
    expect(result).toEqual([]);
  });
});
