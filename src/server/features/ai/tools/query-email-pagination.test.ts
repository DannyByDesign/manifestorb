import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ default: {} }));
vi.mock("@/server/lib/user/get", () => ({
  getEmailAccountWithAi: vi.fn(),
}));

import { queryTool } from "./query";

describe("queryTool email pagination/date forwarding", () => {
  it("forwards pageToken and date bounds to email provider", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [],
      nextPageToken: "next-token",
      totalEstimate: 42,
    });

    const result = await queryTool.execute(
      {
        resource: "email",
        filter: {
          fetchAll: false,
          query: "from:john@example.com",
          limit: 20,
          pageToken: "current-token",
          dateRange: {
            after: "2026-01-01T00:00:00.000Z",
            before: "2026-02-01T00:00:00.000Z",
          },
        },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        providers: {
          email: { search },
        },
      } as any,
    );

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "from:john@example.com",
        limit: 20,
        pageToken: "current-token",
      }),
    );
    const forwarded = search.mock.calls[0][0];
    expect(forwarded.after).toBeInstanceOf(Date);
    expect(forwarded.before).toBeInstanceOf(Date);
    expect((result as any).paging).toEqual({
      nextPageToken: "next-token",
      totalEstimate: 42,
    });
  });
});
