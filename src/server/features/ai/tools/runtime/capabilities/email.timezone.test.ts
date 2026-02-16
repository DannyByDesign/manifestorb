import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createEmailCapabilities } from "@/server/features/ai/tools/runtime/capabilities/email";
import {
  resolveCalendarTimeZoneForRequest,
  resolveDefaultCalendarTimeZone,
} from "@/server/features/ai/tools/calendar-time";
import { searchEmailThreads } from "@/server/features/ai/tools/email/primitives";

vi.mock("@/server/features/ai/tools/calendar-time", () => ({
  resolveCalendarTimeZoneForRequest: vi.fn(),
  resolveDefaultCalendarTimeZone: vi.fn(),
}));

vi.mock("@/server/features/ai/tools/email/primitives", () => ({
  getEmailMessages: vi.fn(),
  getEmailThread: vi.fn(),
  modifyEmailMessages: vi.fn(),
  searchEmailThreads: vi.fn(),
  trashEmailMessages: vi.fn(),
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

describe("runtime email timezone handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveDefaultCalendarTimeZone).mockResolvedValue({
      timeZone: "America/Los_Angeles",
      source: "integration",
    });
    vi.mocked(resolveCalendarTimeZoneForRequest).mockImplementation(
      ({ requestedTimeZone, defaultTimeZone }) => ({
        timeZone: requestedTimeZone ?? defaultTimeZone,
      }),
    );
    vi.mocked(searchEmailThreads).mockResolvedValue({
      messages: [],
      nextPageToken: undefined,
      totalEstimate: 0,
    });
  });

  it("parses date-only search bounds in the user's integration timezone", async () => {
    const caps = createEmailCapabilities(buildEnv());
    await caps.searchThreads({
      query: "inbox",
      dateRange: {
        after: "2026-02-16",
        before: "2026-02-16",
      },
    });

    expect(searchEmailThreads).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.any(Date),
        before: expect.any(Date),
      }),
    );

    const filter = vi.mocked(searchEmailThreads).mock.calls[0]?.[1] as {
      after?: Date;
      before?: Date;
    };
    expect(filter.after?.toISOString()).toBe("2026-02-16T08:00:00.000Z");
    expect(filter.before?.toISOString()).toBe("2026-02-17T07:59:59.999Z");
  });

  it("does not force receivedByMe for inbox search", async () => {
    const caps = createEmailCapabilities(buildEnv());

    await caps.searchInbox({
      query: "in:inbox",
      limit: 1,
    });

    const filter = vi.mocked(searchEmailThreads).mock.calls[0]?.[1] as {
      receivedByMe?: boolean;
    };
    expect(filter.receivedByMe).toBeUndefined();
  });

  it("returns localized display time fields for inbox items", async () => {
    vi.mocked(searchEmailThreads).mockResolvedValueOnce({
      messages: [
        {
          id: "m-1",
          threadId: "t-1",
          snippet: "Test snippet",
          historyId: "h-1",
          inline: [],
          headers: {
            subject: "Hello",
            from: "sender@example.com",
            to: "user@example.com",
            date: "Sat, 14 Feb 2026 03:32:14 +0000",
          },
          subject: "Hello",
          textPlain: "Body",
          date: "Sat, 14 Feb 2026 03:32:14 +0000",
          internalDate: "1771039934000",
        },
      ] as never[],
      nextPageToken: undefined,
      totalEstimate: 1,
    });

    const caps = createEmailCapabilities(buildEnv());
    const result = await caps.searchInbox({ limit: 1 });
    expect(result.success).toBe(true);

    const item = Array.isArray(result.data)
      ? (result.data[0] as Record<string, unknown> | undefined)
      : undefined;
    expect(typeof item?.date).toBe("string");
    expect(String(item?.date)).toContain("T");
    expect(typeof item?.dateLocal).toBe("string");
    expect(String(item?.dateLocal)).not.toContain("+0000");
  });

  it("uses a wider default limit for unread-attention inbox searches", async () => {
    const caps = createEmailCapabilities(buildEnv());

    await caps.searchInbox({
      query: "is:unread",
    });

    const filter = vi.mocked(searchEmailThreads).mock.calls[0]?.[1] as {
      limit?: number;
    };
    expect(filter.limit).toBe(60);
  });

  it("uses count-purpose limits for count-grade requests", async () => {
    const caps = createEmailCapabilities(buildEnv());

    await caps.searchInbox({
      query: "",
      purpose: "count",
      dateRange: {
        after: "2026-02-16",
        before: "2026-02-16",
      },
      fetchAll: true,
    });

    const filter = vi.mocked(searchEmailThreads).mock.calls[0]?.[1] as {
      limit?: number;
      fetchAll?: boolean;
    };
    expect(filter.limit).toBe(5000);
    expect(filter.fetchAll).toBe(true);
  });

  it("returns exact unread count from provider counters", async () => {
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
  });

  it("falls back to unread estimate when provider counter lookup fails", async () => {
    const getUnreadCount = vi.fn().mockRejectedValue(new Error("provider down"));
    vi.mocked(searchEmailThreads).mockResolvedValueOnce({
      messages: [],
      nextPageToken: "token-1",
      totalEstimate: 9876,
    });
    const caps = createEmailCapabilities(
      buildEnv({ emailProvider: { getUnreadCount } as never }),
    );

    const result = await caps.getUnreadCount({});
    expect(result.success).toBe(true);
    expect((result.data as { count: number; exact: boolean }).count).toBe(9876);
    expect((result.data as { count: number; exact: boolean }).exact).toBe(false);
  });

  it("falls back from strict sender filter to mention search when strict sender has no matches", async () => {
    vi.mocked(searchEmailThreads)
      .mockResolvedValueOnce({
        messages: [],
        nextPageToken: undefined,
        totalEstimate: 0,
      })
      .mockResolvedValueOnce({
        messages: [
          {
            id: "m-subject",
            threadId: "t-1",
            snippet: "New Fiverr activity",
            historyId: "h-1",
            inline: [],
            headers: {
              subject: "You've got new messages from Haseeb",
              from: "Fiverr <no-reply@fiverr.com>",
              to: "user@example.com",
              date: "Sat, 14 Feb 2026 05:41:00 +0000",
            },
            subject: "You've got new messages from Haseeb",
            textPlain: "Open Fiverr to respond.",
            date: "Sat, 14 Feb 2026 05:41:00 +0000",
            internalDate: "1771047660000",
          },
          {
            id: "m-body",
            threadId: "t-2",
            snippet: "Haseeb replied",
            historyId: "h-2",
            inline: [],
            headers: {
              subject: "Project updates",
              from: "Fiverr <no-reply@fiverr.com>",
              to: "user@example.com",
              date: "Sat, 14 Feb 2026 06:00:00 +0000",
            },
            subject: "Project updates",
            textPlain: "You received a message from Haseeb.",
            date: "Sat, 14 Feb 2026 06:00:00 +0000",
            internalDate: "1771048800000",
          },
        ] as never[],
        nextPageToken: undefined,
        totalEstimate: 2,
      });

    const caps = createEmailCapabilities(buildEnv());
    const result = await caps.searchInbox({
      from: "Haseeb",
      dateRange: {
        after: "2026-02-09",
        before: "2026-02-16",
      },
      limit: 10,
    });

    expect(searchEmailThreads).toHaveBeenCalledTimes(2);
    expect(vi.mocked(searchEmailThreads).mock.calls[0]?.[1]).toMatchObject({
      from: "Haseeb",
      text: undefined,
    });
    expect(vi.mocked(searchEmailThreads).mock.calls[1]?.[1]).toMatchObject({
      from: undefined,
      text: "Haseeb",
      subjectContains: "Haseeb",
    });

    expect(result.success).toBe(true);
    const items = Array.isArray(result.data) ? result.data : [];
    expect(items).toHaveLength(2);
    expect((items[0] as { id?: string }).id).toBe("m-subject");
  });

  it("keeps sender bulk actions on strict sender matching only", async () => {
    vi.mocked(searchEmailThreads).mockResolvedValueOnce({
      messages: [],
      nextPageToken: undefined,
      totalEstimate: 0,
    });

    const caps = createEmailCapabilities(buildEnv());
    const result = await caps.bulkSenderArchive({ from: "Haseeb" });

    expect(searchEmailThreads).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchEmailThreads).mock.calls[0]?.[1]).toMatchObject({
      from: "Haseeb",
      fetchAll: true,
    });
    expect(result.success).toBe(false);
    expect(result.message).toBe("No matching emails found for this sender action.");
  });
});
