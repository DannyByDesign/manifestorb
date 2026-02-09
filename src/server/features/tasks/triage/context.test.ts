import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTaskTriageContext } from "./context";
import prisma from "@/server/lib/__mocks__/prisma";
import { getUnifiedCalendarAvailability } from "@/features/calendar/unified-availability";
import { ContextManager } from "@/features/memory/context-manager";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client");
vi.mock("@/features/calendar/unified-availability", () => ({
  getUnifiedCalendarAvailability: vi.fn(),
}));
vi.mock("@/features/memory/context-manager", () => ({
  ContextManager: { buildContextPack: vi.fn() },
}));

describe("buildTaskTriageContext", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds a normalized context pack from Prisma data", async () => {
    vi.mocked(prisma.task.findMany)
      .mockResolvedValueOnce([
        {
          id: "task-1",
          title: "Write update",
          description: "Weekly status",
          durationMinutes: 30,
          status: "OPEN",
          priority: "HIGH",
          energyLevel: "HIGH",
          preferredTime: "MORNING",
          dueDate: new Date("2024-01-02T00:00:00.000Z"),
          startDate: null,
          isAutoScheduled: false,
          scheduleLocked: false,
          scheduledStart: null,
          scheduledEnd: null,
          scheduleScore: 80,
          reschedulePolicy: "FLEXIBLE",
          lastScheduled: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "task-2",
          title: "Completed task",
          updatedAt: new Date("2024-01-01T02:00:00.000Z"),
        },
      ]);
    vi.mocked(prisma.taskPreference.findUnique).mockResolvedValue({
      timeZone: "UTC",
      workHourStart: 9,
      workHourEnd: 17,
      workDays: [1, 2, 3, 4, 5],
      bufferMinutes: 15,
      groupByProject: false,
    });
    vi.mocked(prisma.taskSchedulingReason.findMany).mockResolvedValue([
      { taskId: "task-1", reason: { reason: "due soon" } },
    ]);
    vi.mocked(prisma.emailAccount.findUnique).mockResolvedValue({
      id: "email-1",
      email: "user@test.com",
    });
    vi.mocked(getUnifiedCalendarAvailability).mockResolvedValue([
      { start: "2024-01-01T09:00:00.000Z", end: "2024-01-01T10:00:00.000Z" },
    ]);
    vi.mocked(ContextManager.buildContextPack).mockResolvedValue({
      system: { summary: "Focus on deep work" },
      facts: [{ key: "preference_focus", value: "deep work", confidence: 0.9 }],
      knowledge: [{ title: "Work policy", content: "No meetings after 3pm." }],
      history: [],
      documents: [],
    } as any);

    const result = await buildTaskTriageContext({
      userId: "user-1",
      emailAccountId: "email-1",
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          trace: vi.fn(),
          with: vi.fn().mockReturnThis(),
          flush: vi.fn().mockResolvedValue(undefined),
        },
      });

    expect(result.tasks[0]).toMatchObject({
      id: "task-1",
      title: "Write update",
      scheduleLocked: false,
      isAutoScheduled: false,
      scheduleScore: 80,
    });
    expect(result.schedulingReasons).toEqual({
      "task-1": { reason: "due soon" },
    });
    expect(result.taskPreferences?.timeZone).toBe("UTC");
    expect(result.availability.busyPeriods).toHaveLength(1);
    expect(result.memory.summary).toBe("Focus on deep work");
    expect(result.memory.facts).toEqual([
      { key: "preference_focus", value: "deep work", confidence: 0.9 },
    ]);
    expect(result.memory.knowledge).toEqual([
      { title: "Work policy", content: "No meetings after 3pm." },
    ]);
  });

  it("throws when the email account is missing", async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.taskPreference.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.taskSchedulingReason.findMany).mockResolvedValue([]);
    vi.mocked(prisma.task.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.emailAccount.findUnique).mockResolvedValue(null);

    await expect(
      buildTaskTriageContext({
        userId: "user-1",
        emailAccountId: "missing-email",
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          trace: vi.fn(),
          with: vi.fn().mockReturnThis(),
          flush: vi.fn().mockResolvedValue(undefined),
        },
      }),
    ).rejects.toThrow("Email account not found for task triage context");
  });
});
