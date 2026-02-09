import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ default: {} }));
vi.mock("@/server/lib/user/get", () => ({
  getEmailAccountWithAi: vi.fn(),
}));

import { queryTool } from "./query";

describe("queryTool email subscriptions", () => {
  it("filters to likely subscription emails and requests non-primary inbox coverage", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [
        {
          id: "m-1",
          threadId: "t-1",
          snippet: "Weekly digest",
          historyId: "h-1",
          inline: [],
          headers: {
            subject: "Weekly Digest",
            from: "digest@productupdates.com",
            to: "me@example.com",
            date: "2026-02-08T00:00:00.000Z",
            "list-unsubscribe": "<https://example.com/unsub?id=1>",
          },
          subject: "Weekly Digest",
          date: "2026-02-08T00:00:00.000Z",
        },
        {
          id: "m-2",
          threadId: "t-2",
          snippet: "Project notes",
          historyId: "h-2",
          inline: [],
          headers: {
            subject: "Project notes",
            from: "coworker@example.com",
            to: "me@example.com",
            date: "2026-02-08T01:00:00.000Z",
          },
          subject: "Project notes",
          date: "2026-02-08T01:00:00.000Z",
          textPlain: "Please review this draft by tomorrow.",
        },
      ],
      nextPageToken: undefined,
      totalEstimate: 2,
    });

    const result = await queryTool.execute(
      {
        resource: "email",
        filter: {
          fetchAll: false,
          subscriptionsOnly: true,
          limit: 20,
        },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        providers: {
          email: { search },
        },
      } as unknown as Parameters<typeof queryTool.execute>[1],
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        includeNonPrimary: true,
      }),
    );

    expect(result.success).toBe(true);
    const rows = (result.data as Array<{ id?: string }>) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("m-1");
  });
});
