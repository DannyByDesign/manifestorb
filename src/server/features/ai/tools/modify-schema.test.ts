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
vi.mock("@/features/calendar/scheduling/TaskSchedulingService", () => ({
  scheduleTasksForUser: vi.fn(),
}));
vi.mock("@/features/calendar/scheduling/date-utils", () => ({
  isAmbiguousLocalTime: vi.fn(() => false),
  resolveTimeZoneOrUtc: vi.fn((tz?: string) => ({ timeZone: tz ?? "UTC", isFallback: false })),
}));

import { modifyTool } from "./modify";

describe("modifyTool discriminated schema", () => {
  it("allows task scheduleNow without ids", () => {
    const parsed = modifyTool.parameters.safeParse({
      resource: "task",
      changes: { scheduleNow: true },
    });
    expect(parsed.success).toBe(true);
  });

  it("requires ids for email updates", () => {
    const parsed = modifyTool.parameters.safeParse({
      resource: "email",
      changes: { read: true },
    });
    expect(parsed.success).toBe(false);
  });

  it("allows unsubscribe with email filter and no ids", () => {
    const parsed = modifyTool.parameters.safeParse({
      resource: "email",
      filter: { from: "moo.com", subscriptionsOnly: true },
      changes: { unsubscribe: true },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unsubscribe without ids or filter", () => {
    const parsed = modifyTool.parameters.safeParse({
      resource: "email",
      changes: { unsubscribe: true },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unsupported resources", () => {
    const parsed = modifyTool.parameters.safeParse({
      resource: "unknown",
      changes: { targetFolderId: "folder-1" },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts draft updates with ids", () => {
    const parsed = modifyTool.parameters.safeParse({
      resource: "draft",
      ids: ["draft-1"],
      changes: { subject: "Updated" },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts preferences weekStartDay updates", () => {
    const parsed = modifyTool.parameters.safeParse({
      resource: "preferences",
      changes: { weekStartDay: "sunday" },
    });
    expect(parsed.success).toBe(true);
  });
});
