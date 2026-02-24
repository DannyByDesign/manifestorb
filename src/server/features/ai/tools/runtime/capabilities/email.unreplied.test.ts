import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createEmailCapabilities } from "@/server/features/ai/tools/runtime/capabilities/email";
import prisma from "@/server/db/client";

vi.mock("@/server/db/client", () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/server/features/ai/tools/calendar-time", () => ({
  resolveDefaultCalendarTimeZone: vi.fn().mockResolvedValue({
    timeZone: "America/Los_Angeles",
    source: "integration",
  }),
}));

function buildEnv(options?: {
  search?: CapabilityEnvironment["toolContext"]["providers"]["email"]["search"];
  getThread?: CapabilityEnvironment["toolContext"]["providers"]["email"]["getThread"];
}): CapabilityEnvironment {
  const search =
    options?.search ??
    vi.fn().mockResolvedValue({
      messages: [],
      nextPageToken: undefined,
      totalEstimate: 0,
    });
  const getThread =
    options?.getThread ??
    vi.fn().mockResolvedValue({
      messages: [],
    });

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
        email: {
          search,
          getThread,
        } as never,
        calendar: {} as never,
      },
      currentMessage: "",
    },
  };
}

describe("email unrepliedToSent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns clarification key when dateRange is missing", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);
    const caps = createEmailCapabilities(buildEnv());
    const result = await caps.searchSent({
      unrepliedToSent: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("missing_date_range");
    expect(result.clarification?.prompt).toBe("email_unreplied_date_range_required");
    expect(result.clarification?.missingFields).toEqual(["dateRange.after", "dateRange.before"]);
  });

  it("uses DB-first query and maps rows into deterministic response items", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      {
        threadId: "t-1",
        messageId: "m-1",
        sentAt: new Date("2026-02-01T10:00:00.000Z"),
        toHeader: "a@example.com",
        subject: "Hello",
        snippet: "Follow up",
      },
    ]);

    const search = vi.fn();
    const caps = createEmailCapabilities(buildEnv({ search }));
    const result = await caps.searchSent({
      unrepliedToSent: true,
      dateRange: {
        after: "2026-01-15T00:00:00.000Z",
        before: "2026-02-15T00:00:00.000Z",
      },
      limit: 50,
    });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).toEqual([
      expect.objectContaining({
        threadId: "t-1",
        messageId: "m-1",
        subject: "Hello",
        date: "2026-02-01T10:00:00.000Z",
        to: "a@example.com",
        snippet: "Follow up",
      }),
    ]);
    expect(search).not.toHaveBeenCalled();

    const [queryArg] = vi.mocked(prisma.$queryRaw).mock.calls[0] ?? [];
    const queryText =
      queryArg && typeof queryArg === "object" && "sql" in queryArg && typeof queryArg.sql === "string"
        ? queryArg.sql
        : "";
    expect(queryText).toContain("DISTINCT ON");
    expect(queryText).toContain("FROM \"EmailMessage\"");
  });

  it("falls back to provider search scan when DB query fails and preserves unreplied semantics", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("db down"));

    const search = vi.fn().mockResolvedValueOnce({
      messages: [
        { id: "m-a", threadId: "t-a" },
        { id: "m-b", threadId: "t-b" },
        { id: "m-c", threadId: "t-c" },
      ],
      nextPageToken: undefined,
      totalEstimate: 3,
    });

    const getThread = vi.fn(async (threadId: string) => {
      const mk = (p: {
        id: string;
        dateIso: string;
        from: string;
        subject?: string;
        to?: string;
      }) => ({
        id: p.id,
        internalDate: p.dateIso,
        date: p.dateIso,
        subject: p.subject ?? "",
        headers: {
          from: p.from,
          subject: p.subject ?? "",
          to: p.to ?? "",
          cc: "",
        },
      });

      if (threadId === "t-a") {
        return {
          messages: [
            mk({ id: "a1", dateIso: "2026-02-05T10:00:00.000Z", from: "user@example.com", subject: "A", to: "x@co.com" }),
            mk({ id: "a2", dateIso: "2026-02-06T10:00:00.000Z", from: "x@co.com", subject: "Re: A" }),
          ],
        };
      }
      if (threadId === "t-b") {
        return {
          messages: [
            mk({ id: "b1", dateIso: "2026-02-01T09:00:00.000Z", from: "y@co.com", subject: "B" }),
            mk({ id: "b2", dateIso: "2026-02-02T09:00:00.000Z", from: "user@example.com", subject: "Re: B", to: "y@co.com" }),
          ],
        };
      }
      return {
        messages: [
          mk({ id: "c1", dateIso: "2026-02-03T12:00:00.000Z", from: "user@example.com", subject: "C", to: "z@co.com" }),
          mk({ id: "c2", dateIso: "2026-02-04T12:00:00.000Z", from: "user@example.com", subject: "Re: C", to: "z@co.com" }),
        ],
      };
    });

    const caps = createEmailCapabilities(buildEnv({ search, getThread }));
    const result = await caps.searchSent({
      unrepliedToSent: true,
      dateRange: {
        after: "2026-02-01T00:00:00.000Z",
        before: "2026-02-10T00:00:00.000Z",
        timeZone: "UTC",
      },
    });

    expect(vi.mocked(prisma.$queryRaw)).toHaveBeenCalledTimes(1);
    expect(getThread).toHaveBeenCalled();

    expect(result.success).toBe(true);
    const items = Array.isArray(result.data) ? result.data : [];
    const threadIds = items.map((i) => i.threadId).sort();
    expect(threadIds).toEqual(["t-b", "t-c"]);
  });
});
