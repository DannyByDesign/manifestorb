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

describe("modifyTool draft branch", () => {
  it("updates drafts via email provider", async () => {
    const updateDraft = vi.fn().mockResolvedValue(undefined);

    const result = await modifyTool.execute(
      {
        resource: "draft",
        ids: ["draft-1", "draft-2"],
        changes: { subject: "Updated", body: "<p>Hello</p>" },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
        providers: { email: { updateDraft } },
      } as any,
    );

    expect(updateDraft).toHaveBeenNthCalledWith(1, "draft-1", {
      subject: "Updated",
      messageHtml: "<p>Hello</p>",
    });
    expect(updateDraft).toHaveBeenNthCalledWith(2, "draft-2", {
      subject: "Updated",
      messageHtml: "<p>Hello</p>",
    });
    expect(result).toEqual({ success: true, data: { count: 2 } });
  });
});
