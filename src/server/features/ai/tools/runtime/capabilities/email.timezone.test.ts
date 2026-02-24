import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedMessage } from "@/server/lib/types";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createEmailCapabilities } from "@/server/features/ai/tools/runtime/capabilities/email";

const resolveDefaultCalendarTimeZoneMock = vi.hoisted(() => vi.fn());
const resolveCalendarTimeZoneForRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/features/ai/tools/calendar-time", () => ({
  resolveDefaultCalendarTimeZone: resolveDefaultCalendarTimeZoneMock,
  resolveCalendarTimeZoneForRequest: resolveCalendarTimeZoneForRequestMock,
}));

vi.mock("@/server/features/ai/tools/email/primitives", () => ({
  getEmailMessages: vi.fn().mockResolvedValue([]),
  getEmailThread: vi.fn().mockRejectedValue(new Error("not found")),
  modifyEmailMessages: vi.fn().mockResolvedValue({ success: true, count: 0 }),
  trashEmailMessages: vi.fn().mockResolvedValue({ success: true, count: 0 }),
}));

function message(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    id: overrides.id ?? "m-1",
    threadId: overrides.threadId ?? "t-1",
    snippet: overrides.snippet ?? "",
    historyId: overrides.historyId ?? "h-1",
    inline: overrides.inline ?? [],
    headers: overrides.headers ?? {
      subject: "Subject",
      from: "sender@example.com",
      to: "user@example.com",
      date: "Tue, 16 Feb 2026 12:00:00 +0000",
    },
    subject: overrides.subject ?? "Subject",
    date: overrides.date ?? "2026-02-16T12:00:00.000Z",
    internalDate: overrides.internalDate ?? "2026-02-16T12:00:00.000Z",
    attachments: overrides.attachments,
    textPlain: overrides.textPlain,
    textHtml: overrides.textHtml,
    labelIds: overrides.labelIds,
  };
}

function buildEnv(options?: {
  currentMessage?: string;
  search?: CapabilityEnvironment["toolContext"]["providers"]["email"]["search"];
  getUnreadCount?: CapabilityEnvironment["toolContext"]["providers"]["email"]["getUnreadCount"];
}): CapabilityEnvironment {
  const search =
    options?.search ??
    vi.fn().mockResolvedValue({
      messages: [],
      nextPageToken: undefined,
      totalEstimate: 0,
    });
  const getUnreadCount =
    options?.getUnreadCount ??
    vi.fn().mockResolvedValue({
      count: 0,
      exact: true,
    });

  return {
    runtime: {
      userId: "user-1",
      emailAccountId: "account-1",
      email: "user@example.com",
      provider: "web",
      currentMessage: options?.currentMessage,
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
      currentMessage: options?.currentMessage,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      },
      providers: {
        email: {
          search,
          getUnreadCount,
        } as never,
        calendar: {} as never,
      },
    },
  };
}

describe("runtime email provider search routing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolveDefaultCalendarTimeZoneMock.mockResolvedValue({
      timeZone: "America/Los_Angeles",
      source: "integration",
    });
    resolveCalendarTimeZoneForRequestMock.mockImplementation(
      ({ requestedTimeZone, defaultTimeZone }) => ({
        timeZone: requestedTimeZone ?? defaultTimeZone,
      }),
    );
  });

  it("routes inbox search through provider with mailbox and date bounds", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [],
      nextPageToken: undefined,
      totalEstimate: 0,
    });
    const caps = createEmailCapabilities(buildEnv({ search }));

    await caps.search({
      mailbox: "inbox",
      query: "portfolio review",
      dateRange: {
        after: "2026-02-16",
        before: "2026-02-16",
        timeZone: "America/Los_Angeles",
      },
      limit: 25,
      fetchAll: true,
    });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "in:inbox portfolio review",
        limit: 25,
        fetchAll: true,
      }),
    );
    const arg = search.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.receivedByMe).toBeUndefined();
    expect(arg.after).toBeInstanceOf(Date);
    expect(arg.before).toBeInstanceOf(Date);
  });

  it("routes sent search through provider sentByMe", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [],
      nextPageToken: undefined,
      totalEstimate: 0,
    });
    const caps = createEmailCapabilities(buildEnv({ search }));
    await caps.search({ mailbox: "sent", query: "portfolio review", limit: 10 });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "in:sent portfolio review",
        sentByMe: true,
        limit: 10,
      }),
    );
  });

  it("preserves explicit receivedByMe inbox filters when provided", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [],
      nextPageToken: undefined,
      totalEstimate: 0,
    });
    const caps = createEmailCapabilities(buildEnv({ search }));

    await caps.search({
      mailbox: "inbox",
      query: "updates",
      receivedByMe: true,
    });

    const arg = search.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.receivedByMe).toBe(true);
  });

  it("normalizes natural-language today into provider date bounds", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [],
      nextPageToken: undefined,
      totalEstimate: 0,
    });
    const caps = createEmailCapabilities(buildEnv({ search }));

    await caps.search({
      mailbox: "inbox",
      query: "today",
      unread: true,
    });

    const arg = search.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.after).toBeInstanceOf(Date);
    expect(arg.before).toBeInstanceOf(Date);
  });

  it("does not inject raw user-turn text into provider query when query/text is missing", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [],
      nextPageToken: undefined,
      totalEstimate: 0,
    });
    const caps = createEmailCapabilities(
      buildEnv({
        search,
        currentMessage: "Show me my 10 most recent unread emails",
      }),
    );

    await caps.search({
      mailbox: "inbox",
      unread: true,
      limit: 10,
    });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "in:inbox is:unread",
        limit: 10,
      }),
    );
    const arg = search.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.receivedByMe).toBeUndefined();
  });

  it("maps provider email messages into capability response items", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [
        message({
          id: "m-1",
          threadId: "t-1",
          subject: "Portfolio review",
          snippet: "Let's discuss tomorrow",
          headers: {
            subject: "Portfolio review",
            from: "sender@example.com",
            to: "user@example.com",
            date: "Tue, 16 Feb 2026 12:00:00 +0000",
          },
          attachments: [
            {
              filename: "brief.pdf",
              mimeType: "application/pdf",
              size: 5,
              attachmentId: "a-1",
              headers: {
                "content-type": "application/pdf",
                "content-description": "",
                "content-transfer-encoding": "base64",
                "content-id": "",
              },
            },
          ],
        }),
      ],
      nextPageToken: "next-1",
      totalEstimate: 2,
    });

    const caps = createEmailCapabilities(buildEnv({ search }));
    const result = await caps.search({ mailbox: "inbox", query: "portfolio review" });

    expect(result.success).toBe(true);
    const items = Array.isArray(result.data) ? result.data : [];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "m-1",
      threadId: "t-1",
      title: "Portfolio review",
      snippet: "Let's discuss tomorrow",
      from: "sender@example.com",
      to: "user@example.com",
      hasAttachment: true,
      attachmentNames: ["brief.pdf"],
    });
    expect(result.truncated).toBe(true);
    expect(result.paging).toEqual({
      nextPageToken: "next-1",
      totalEstimate: 2,
      coverage: {
        completeness: "partial",
        mailboxScope: "inbox",
      },
    });
  });

  it("avoids definitive zero-result claims when search coverage is partial", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [],
      nextPageToken: "next-1",
      totalEstimate: 250,
    });

    const caps = createEmailCapabilities(buildEnv({ search }));
    const result = await caps.search({ mailbox: "inbox", query: "investor updates" });

    expect(result.success).toBe(true);
    expect(result.message).toContain("scanned portion");
    expect(result.truncated).toBe(true);
    expect(result.paging).toEqual(
      expect.objectContaining({
        coverage: expect.objectContaining({
          completeness: "partial",
        }),
      }),
    );
  });

  it("derives sender/domain facets from provider search results", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [
        message({
          id: "m-1",
          threadId: "t-1",
          headers: {
            subject: "A",
            from: "Alice <alice@alpha.com>",
            to: "user@example.com",
            date: "Tue, 16 Feb 2026 12:00:00 +0000",
          },
        }),
        message({
          id: "m-2",
          threadId: "t-2",
          headers: {
            subject: "B",
            from: "alice@alpha.com",
            to: "user@example.com",
            date: "Tue, 16 Feb 2026 12:00:00 +0000",
          },
        }),
        message({
          id: "m-3",
          threadId: "t-3",
          headers: {
            subject: "C",
            from: "bob@beta.com",
            to: "user@example.com",
            date: "Tue, 16 Feb 2026 12:00:00 +0000",
          },
        }),
      ],
    });
    const caps = createEmailCapabilities(buildEnv({ search }));
    const result = await caps.facetThreads({
      filter: { query: "invoices" },
      maxFacets: 5,
      scanLimit: 100,
    });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "invoices",
        limit: 100,
        fetchAll: false,
      }),
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual(
      expect.objectContaining({
        scannedMessages: 3,
        topSenders: expect.arrayContaining([
          expect.objectContaining({ email: "alice@alpha.com", count: 2 }),
          expect.objectContaining({ email: "bob@beta.com", count: 1 }),
        ]),
        topDomains: expect.arrayContaining([
          expect.objectContaining({ domain: "alpha.com", count: 2 }),
          expect.objectContaining({ domain: "beta.com", count: 1 }),
        ]),
      }),
    );
  });

  it("returns exact unread count from provider counters when available", async () => {
    const getUnreadCount = vi.fn().mockResolvedValue({
      count: 1234,
      exact: true,
    });
    const search = vi.fn();
    const caps = createEmailCapabilities(
      buildEnv({ search, getUnreadCount }),
    );

    const result = await caps.countUnread({});
    expect(getUnreadCount).toHaveBeenCalledWith({ scope: "inbox" });
    expect(result.success).toBe(true);
    expect((result.data as { count: number; exact: boolean }).count).toBe(1234);
    expect((result.data as { count: number; exact: boolean }).exact).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it("supports scoped unread count lookups for primary", async () => {
    const getUnreadCount = vi.fn().mockResolvedValue({
      count: 27,
      exact: false,
    });
    const search = vi.fn();
    const caps = createEmailCapabilities(
      buildEnv({ search, getUnreadCount }),
    );

    const result = await caps.countUnread({ scope: "primary" });
    expect(getUnreadCount).toHaveBeenCalledWith({ scope: "primary" });
    expect(result.success).toBe(true);
    expect((result.data as { count: number; exact: boolean; scope: string }).count).toBe(27);
    expect((result.data as { count: number; exact: boolean; scope: string }).exact).toBe(false);
    expect((result.data as { count: number; exact: boolean; scope: string }).scope).toBe("primary");
    expect(search).not.toHaveBeenCalled();
  });

  it("falls back to provider search when provider counters fail", async () => {
    const getUnreadCount = vi.fn().mockRejectedValue(new Error("provider down"));
    const search = vi.fn().mockResolvedValue({
      messages: [],
      nextPageToken: "next-1",
      totalEstimate: 9876,
    });
    const caps = createEmailCapabilities(
      buildEnv({ search, getUnreadCount }),
    );

    const result = await caps.countUnread({});
    expect(result.success).toBe(true);
    expect((result.data as { count: number; exact: boolean }).count).toBe(9876);
    expect((result.data as { count: number; exact: boolean }).exact).toBe(false);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "in:inbox is:unread",
        limit: 100,
        fetchAll: false,
      }),
    );
    const arg = search.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.receivedByMe).toBeUndefined();
  });

  it("uses provider search for sender bulk actions without duplicate search paths", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [],
      nextPageToken: undefined,
      totalEstimate: 0,
    });
    const caps = createEmailCapabilities(buildEnv({ search }));
    const result = await caps.bulkSenderArchive({ from: "Haseeb" });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Haseeb",
        limit: 500,
        fetchAll: true,
      }),
    );
    expect(result.success).toBe(false);
    expect(result.message).toBe("No matching emails found for this sender action.");
  });

  it("uses scoped provider search for temporal unread counts", async () => {
    const search = vi.fn().mockResolvedValue({
      messages: [message({ id: "m-1" }), message({ id: "m-2" })],
      nextPageToken: undefined,
      totalEstimate: 2,
    });
    const getUnreadCount = vi.fn();
    const caps = createEmailCapabilities(buildEnv({ search, getUnreadCount }));

    const result = await caps.countUnread({
      scope: "inbox",
      dateRange: {
        after: "2026-02-16",
        before: "2026-02-16",
        timeZone: "America/Los_Angeles",
      },
    });

    expect(result.success).toBe(true);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "in:inbox is:unread",
        fetchAll: true,
      }),
    );
    const arg = search.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.after).toBeInstanceOf(Date);
    expect(arg.before).toBeInstanceOf(Date);
    expect(getUnreadCount).not.toHaveBeenCalled();
  });

  it("delegates countUnread without filters to provider counter path", async () => {
    const getUnreadCount = vi.fn().mockResolvedValue({
      count: 9,
      exact: true,
    });
    const search = vi.fn();
    const caps = createEmailCapabilities(buildEnv({ search, getUnreadCount }));

    const result = await caps.countUnread({ scope: "inbox" });

    expect(result.success).toBe(true);
    expect(getUnreadCount).toHaveBeenCalledWith({ scope: "inbox" });
    expect(search).not.toHaveBeenCalled();
  });
});
