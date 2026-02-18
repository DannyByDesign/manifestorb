import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createEmailCapabilities } from "@/server/features/ai/tools/runtime/capabilities/email";
import { createUnifiedSearchService } from "@/server/features/search/unified/service";

const unifiedQuery = vi.fn();

vi.mock("@/server/features/search/unified/service", () => ({
  createUnifiedSearchService: vi.fn(() => ({
    query: unifiedQuery,
  })),
}));

vi.mock("@/server/features/ai/tools/calendar-time", () => ({
  resolveDefaultCalendarTimeZone: vi.fn().mockResolvedValue({
    timeZone: "America/Los_Angeles",
    source: "integration",
  }),
}));

vi.mock("@/server/features/ai/tools/email/primitives", () => ({
  getEmailMessages: vi.fn().mockResolvedValue([]),
  getEmailThread: vi.fn().mockRejectedValue(new Error("not found")),
  modifyEmailMessages: vi.fn().mockResolvedValue({ success: true, count: 0 }),
  trashEmailMessages: vi.fn().mockResolvedValue({ success: true, count: 0 }),
}));

function buildEnv(options?: {
  emailProvider?: CapabilityEnvironment["toolContext"]["providers"]["email"];
}): CapabilityEnvironment {
  return {
    runtime: {
      userId: "user-1",
      emailAccountId: "account-1",
      email: "user@example.com",
      provider: "web",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      },
    },
    toolContext: {
      userId: "user-1",
      emailAccountId: "account-1",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      },
      providers: {
        email: options?.emailProvider ?? ({} as never),
        calendar: {} as never,
      },
    },
  };
}

describe("runtime email unified search routing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createUnifiedSearchService).mockReturnValue({
      query: unifiedQuery,
    } as never);
    unifiedQuery.mockResolvedValue({
      items: [],
      counts: { email: 0, calendar: 0, rule: 0, memory: 0 },
      total: 0,
      truncated: false,
    });
  });

  it("routes inbox search through unified search with mailbox override", async () => {
    const caps = createEmailCapabilities(buildEnv());

    await caps.searchInbox({
      query: "portfolio review",
      dateRange: {
        after: "2026-02-16",
        before: "2026-02-16",
        timeZone: "America/Los_Angeles",
      },
      limit: 25,
      fetchAll: true,
    });

    expect(unifiedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ["email"],
        mailbox: "inbox",
        query: "portfolio review",
        dateRange: {
          after: "2026-02-16",
          before: "2026-02-16",
          timeZone: "America/Los_Angeles",
        },
        limit: 25,
        fetchAll: true,
      }),
    );
  });

  it("routes sent search through unified search with sent mailbox", async () => {
    const caps = createEmailCapabilities(buildEnv());
    await caps.searchSent({ query: "portfolio review", limit: 10 });

    expect(unifiedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        mailbox: "sent",
        query: "portfolio review",
        limit: 10,
      }),
    );
  });

  it("sanitizes suspicious sender filters into text hints before unified search", async () => {
    const caps = createEmailCapabilities(buildEnv());
    await caps.searchInbox({
      from: "our conversation memory",
      query: "",
    });

    expect(unifiedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        mailbox: "inbox",
        from: undefined,
        text: "our conversation memory",
      }),
    );
  });

  it("strips temporal suffixes from sender filters", async () => {
    const caps = createEmailCapabilities(buildEnv());
    await caps.searchInbox({
      from: "Haseeb in the last 7 days",
      query: "",
    });

    expect(unifiedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        mailbox: "inbox",
        from: "Haseeb",
      }),
    );
  });

  it("maps unified email items into capability response items", async () => {
    unifiedQuery.mockResolvedValueOnce({
      items: [
        {
          surface: "email",
          id: "email:m-1",
          title: "Portfolio review",
          snippet: "Let's discuss tomorrow",
          timestamp: "2026-02-16T12:00:00.000Z",
          score: 0.99,
          metadata: {
            messageId: "m-1",
            threadId: "t-1",
            from: "sender@example.com",
            to: "user@example.com",
            hasAttachment: true,
          },
        },
        {
          surface: "calendar",
          id: "calendar:e-1",
          title: "Calendar event",
          snippet: "",
          score: 0.2,
        },
      ],
      counts: { email: 1, calendar: 1, rule: 0, memory: 0 },
      total: 2,
      truncated: true,
    });

    const caps = createEmailCapabilities(buildEnv());
    const result = await caps.searchInbox({ query: "portfolio review" });

    expect(result.success).toBe(true);
    const items = Array.isArray(result.data) ? result.data : [];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "m-1",
      threadId: "t-1",
      title: "Portfolio review",
      snippet: "Let's discuss tomorrow",
      date: "2026-02-16T12:00:00.000Z",
      from: "sender@example.com",
      to: "user@example.com",
      hasAttachment: true,
    });
    expect(result.truncated).toBe(true);
    expect(result.paging).toEqual({
      nextPageToken: null,
      totalEstimate: 2,
    });
  });

  it("returns exact unread count from provider counters when available", async () => {
    const getUnreadCount = vi.fn().mockResolvedValue({
      count: 1234,
      exact: true,
    });
    const caps = createEmailCapabilities(
      buildEnv({ emailProvider: { getUnreadCount } as never }),
    );

    const result = await caps.getUnreadCount({});
    expect(getUnreadCount).toHaveBeenCalledWith({ scope: "inbox" });
    expect(result.success).toBe(true);
    expect((result.data as { count: number; exact: boolean }).count).toBe(1234);
    expect((result.data as { count: number; exact: boolean }).exact).toBe(true);
    expect(unifiedQuery).not.toHaveBeenCalled();
  });

  it("falls back to unified unread search when provider counters fail", async () => {
    const getUnreadCount = vi.fn().mockRejectedValue(new Error("provider down"));
    unifiedQuery.mockResolvedValueOnce({
      items: [],
      counts: { email: 0, calendar: 0, rule: 0, memory: 0 },
      total: 9876,
      truncated: true,
    });
    const caps = createEmailCapabilities(
      buildEnv({ emailProvider: { getUnreadCount } as never }),
    );

    const result = await caps.getUnreadCount({});
    expect(result.success).toBe(true);
    expect((result.data as { count: number; exact: boolean }).count).toBe(9876);
    expect((result.data as { count: number; exact: boolean }).exact).toBe(false);
    expect(unifiedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ["email"],
        mailbox: "inbox",
        query: "unread",
        unread: true,
        sort: "newest",
        limit: 100,
        fetchAll: false,
      }),
    );
  });

  it("uses unified search for sender bulk actions without duplicate search paths", async () => {
    const caps = createEmailCapabilities(buildEnv());
    const result = await caps.bulkSenderArchive({ from: "Haseeb" });

    expect(unifiedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ["email"],
        from: "Haseeb",
        limit: 1000,
        fetchAll: true,
      }),
    );
    expect(result.success).toBe(false);
    expect(result.message).toBe("No matching emails found for this sender action.");
  });
});
