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

describe("modifyTool unsubscribe by filter", () => {
  it("resolves ids from filter when unsubscribe is requested without explicit ids", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [
        {
          id: "m-1",
          threadId: "t-1",
          snippet: "Newsletter",
          historyId: "h-1",
          inline: [],
          headers: {
            subject: "Weekly update",
            from: "MOO <news@moo.com>",
            to: "me@example.com",
            date: "2026-02-09T00:00:00.000Z",
          },
          subject: "Weekly update",
          date: "2026-02-09T00:00:00.000Z",
        },
      ],
    });
    const get = vi.fn().mockResolvedValue([
      {
        id: "m-1",
        threadId: "t-1",
        snippet: "Newsletter",
        historyId: "h-1",
        inline: [],
        headers: {
          subject: "Weekly update",
          from: "MOO <news@moo.com>",
          to: "me@example.com",
          date: "2026-02-09T00:00:00.000Z",
        },
        subject: "Weekly update",
        date: "2026-02-09T00:00:00.000Z",
      },
    ]);
    const unsubscribe = vi.fn().mockResolvedValue({ success: true });

    const result = await modifyTool.execute(
      {
        resource: "email",
        filter: {
          from: "moo.com",
          subscriptionsOnly: true,
          fetchAll: true,
        },
        changes: { unsubscribe: true },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
        providers: {
          email: { search, get },
          automation: { unsubscribe },
        },
      } as unknown as Parameters<typeof modifyTool.execute>[1],
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "moo.com",
        includeNonPrimary: true,
        fetchAll: true,
      }),
    );
    expect(get).toHaveBeenCalledWith(["m-1"]);
    expect(unsubscribe).toHaveBeenCalledWith("news@moo.com");
    expect(result.success).toBe(true);
  });
});
