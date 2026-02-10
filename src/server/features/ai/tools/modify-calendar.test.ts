import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({
  default: {
    emailAccount: {
      findUnique: vi.fn().mockResolvedValue({ timezone: "America/Los_Angeles" }),
    },
    calendar: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    taskPreference: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));
vi.mock("@/features/approvals/service", () => ({
  ApprovalService: class {},
}));
vi.mock("@/features/email/provider", () => ({
  createEmailProvider: vi.fn(),
}));
vi.mock("@/features/reply-tracker/handle-conversation-status", () => ({
  updateThreadTrackers: vi.fn(),
}));
vi.mock("@/server/lib/user/get", () => ({
  getEmailAccountWithAi: vi.fn(),
}));

const { scheduleTasksForUserMock } = vi.hoisted(() => ({
  scheduleTasksForUserMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/features/calendar/scheduling/TaskSchedulingService", () => ({
  scheduleTasksForUser: scheduleTasksForUserMock,
}));
vi.mock("@/features/calendar/scheduling/date-utils", () => ({
  isAmbiguousLocalTime: vi.fn(() => false),
}));

import { modifyTool } from "./modify";

describe("modifyTool calendar recurrence semantics", () => {
  it("requires recurrenceRule when isRecurring is true", async () => {
    const result = await modifyTool.execute(
      {
        resource: "calendar",
        ids: ["evt-1"],
        changes: { isRecurring: true },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
        providers: { calendar: { updateEvent: vi.fn() } },
      } as any,
    );

    expect(result).toEqual({
      success: false,
      error: "recurrenceRule is required when isRecurring is true",
    });
  });

  it("forwards single/series mode to calendar provider updates", async () => {
    const updateEvent = vi.fn().mockResolvedValue({ id: "evt-1" });

    const result = await modifyTool.execute(
      {
        resource: "calendar",
        ids: ["evt-1"],
        changes: { mode: "series", title: "Updated meeting" },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
        providers: { calendar: { updateEvent } },
      } as any,
    );

    expect(updateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt-1",
        input: expect.objectContaining({
          title: "Updated meeting",
          mode: "series",
        }),
      }),
    );
    expect(result.success).toBe(true);
  });

  it("reschedules to the next later slot when strategy is later", async () => {
    const updateEvent = vi.fn().mockResolvedValue({ id: "evt-1" });
    const getEvent = vi.fn().mockResolvedValue({
      id: "evt-1",
      title: "1:1",
      startTime: new Date("2026-02-13T18:00:00.000Z"),
      endTime: new Date("2026-02-13T19:00:00.000Z"),
      attendees: [],
    });
    const findAvailableSlots = vi.fn().mockResolvedValue([
      {
        start: new Date("2026-02-13T23:00:00.000Z"),
        end: new Date("2026-02-14T00:00:00.000Z"),
        score: 0.9,
      },
    ]);

    const result = await modifyTool.execute(
      {
        resource: "calendar",
        ids: ["evt-1"],
        changes: { rescheduleStrategy: "later" },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
        providers: { calendar: { updateEvent, getEvent, findAvailableSlots } },
      } as any,
    );

    expect(getEvent).toHaveBeenCalledWith({ eventId: "evt-1", calendarId: undefined });
    expect(findAvailableSlots).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMinutes: 60,
      }),
    );
    expect(updateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt-1",
        input: expect.objectContaining({
          start: new Date("2026-02-13T23:00:00.000Z"),
          end: new Date("2026-02-14T00:00:00.000Z"),
        }),
      }),
    );
    expect(result.success).toBe(true);
  });

  it("preserves existing duration when only start is provided", async () => {
    const updateEvent = vi.fn().mockResolvedValue({ id: "evt-1" });
    const getEvent = vi.fn().mockResolvedValue({
      id: "evt-1",
      title: "Sync",
      startTime: new Date("2026-02-14T18:00:00.000Z"),
      endTime: new Date("2026-02-14T18:30:00.000Z"),
      attendees: [],
    });

    const result = await modifyTool.execute(
      {
        resource: "calendar",
        ids: ["evt-1"],
        changes: { start: "2026-02-14T20:00:00Z" },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
        providers: {
          calendar: {
            updateEvent,
            getEvent,
            findAvailableSlots: vi.fn(),
          },
        },
      } as any,
    );

    expect(updateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt-1",
        input: expect.objectContaining({
          start: new Date("2026-02-14T20:00:00.000Z"),
          end: new Date("2026-02-14T20:30:00.000Z"),
        }),
      }),
    );
    expect(result.success).toBe(true);
  });

  it("asks for a wider window when no slot is available for reschedule", async () => {
    const getEvent = vi.fn().mockResolvedValue({
      id: "evt-1",
      title: "1:1",
      startTime: new Date("2026-02-13T18:00:00.000Z"),
      endTime: new Date("2026-02-13T19:00:00.000Z"),
      attendees: [],
    });
    const findAvailableSlots = vi.fn().mockResolvedValue([]);

    const result = await modifyTool.execute(
      {
        resource: "calendar",
        ids: ["evt-1"],
        changes: { reschedule: "later" },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
        providers: { calendar: { updateEvent: vi.fn(), getEvent, findAvailableSlots } },
      } as any,
    );

    expect(result.success).toBe(false);
    expect(result.clarification?.prompt).toContain("couldn't find an open slot");
  });
});
