import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ default: {} }));
vi.mock("@/server/lib/user/get", () => ({
  getEmailAccountWithAi: vi.fn(),
}));

import { queryTool } from "./query";

describe("queryTool email semantic filters", () => {
  it("compiles semantic fields into provider query and forwards structured filters", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [
        {
          id: "m-1",
          threadId: "t-1",
          snippet: "Body mentions E2E",
          historyId: "h-1",
          inline: [],
          headers: {
            subject: "E2E cleanup",
            from: "me@example.com",
            to: "me@example.com",
            date: "2026-02-08T00:00:00.000Z",
          },
          subject: "E2E cleanup",
          date: "2026-02-08T00:00:00.000Z",
        },
      ],
      nextPageToken: undefined,
      totalEstimate: 1,
    });

    const result = await queryTool.execute(
      {
        resource: "email",
        filter: {
          fetchAll: false,
          subjectContains: "E2E",
          from: "me@example.com",
          to: "me@example.com",
          text: "cleanup",
          limit: 20,
          dateRange: {
            after: "2026-02-04T00:00:00.000Z",
            before: "2026-02-09T00:00:00.000Z",
          },
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

    expect(search).toHaveBeenCalledTimes(1);
    const forwarded = search.mock.calls[0][0];
    expect(forwarded.query).toContain("subject:E2E");
    expect(forwarded.query).toContain("from:me@example.com");
    expect(forwarded.query).toContain("to:me@example.com");
    expect(forwarded.subjectContains).toBe("E2E");
    expect(forwarded.text).toBe("cleanup");

    expect(result.success).toBe(true);
    const rows = (result.data as Array<{ title?: string }>) ?? [];
    expect(rows.length).toBe(1);
    expect(rows[0]?.title).toBe("E2E cleanup");
  });

  it("avoids brittle provider-level from clauses for non-email sender names", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [],
      nextPageToken: undefined,
      totalEstimate: 0,
    });

    await queryTool.execute(
      {
        resource: "email",
        filter: {
          fetchAll: false,
          from: "Yingying Sun",
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

    const forwarded = search.mock.calls[0][0];
    expect(forwarded.query).not.toContain("from:");
    expect(forwarded.from).toBe("Yingying Sun");
    expect(forwarded.limit).toBe(20);
  });

  it("skips semantic overfetch for structured sender/date lookups", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [],
      nextPageToken: undefined,
      totalEstimate: 0,
    });

    await queryTool.execute(
      {
        resource: "email",
        filter: {
          fetchAll: false,
          query: "show emails from Yingying Sun from last 7 days",
          from: "Yingying Sun",
          dateRange: {
            after: "2026-02-02T00:00:00.000Z",
            before: "2026-02-09T00:00:00.000Z",
          },
        },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        providers: {
          email: { search },
        },
      } as unknown as Parameters<typeof queryTool.execute>[1],
    );

    const forwarded = search.mock.calls[0][0];
    expect(forwarded.limit).toBe(25);
  });
});
