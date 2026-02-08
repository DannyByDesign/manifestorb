import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ default: {} }));
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
  resolveTimeZoneOrUtc: vi.fn((tz?: string) => ({ timeZone: tz ?? "UTC", isFallback: false })),
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
});
