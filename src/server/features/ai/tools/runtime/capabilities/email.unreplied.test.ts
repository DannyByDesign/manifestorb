import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createEmailCapabilities } from "@/server/features/ai/tools/runtime/capabilities/email";
import { createUnifiedSearchService } from "@/server/features/search/unified/service";
import prisma from "@/server/db/client";

const unifiedQuery = vi.fn();

vi.mock("@/server/features/search/unified/service", () => ({
  createUnifiedSearchService: vi.fn(() => ({
    query: unifiedQuery,
  })),
}));

vi.mock("@/server/db/client", () => ({
  default: {
    $queryRaw: vi.fn(),
  },
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
      currentMessage: "",
    },
  };
}

describe("email unrepliedToSent", () => {
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

  it("returns clarification key when dateRange is missing", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);
    const caps = createEmailCapabilities(buildEnv());
    const result = await caps.searchSent({
      unrepliedToSent: true,
      // no dateRange
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

    const provider = {
      search: vi.fn(),
      getThread: vi.fn(),
    };

    const caps = createEmailCapabilities(buildEnv({ emailProvider: provider as never }));
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
    expect(provider.search).not.toHaveBeenCalled();
    expect(unifiedQuery).not.toHaveBeenCalled();

    const [queryArg] = vi.mocked(prisma.$queryRaw).mock.calls[0] ?? [];
    expect((queryArg as any)?.sql ?? "").toContain("DISTINCT ON");
    expect((queryArg as any)?.sql ?? "").toContain("FROM \"EmailMessage\"");
  });

  it("falls back to provider scanning when DB query fails and preserves unreplied semantics", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("db down"));

    const provider = {
      search: vi.fn().mockResolvedValue({
        messages: [
          { id: "m-a", threadId: "t-a" },
          { id: "m-b", threadId: "t-b" },
          { id: "m-c", threadId: "t-c" },
        ],
      }),
      getThread: vi.fn(async (threadId: string) => {
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

        // Semantics: "reply" means any inbound message after the *last* sent message.
        if (threadId === "t-a") {
          // Last sent, then inbound reply after -> excluded.
          return {
            messages: [
              mk({ id: "a1", dateIso: "2026-02-05T10:00:00.000Z", from: "user@example.com", subject: "A", to: "x@co.com" }),
              mk({ id: "a2", dateIso: "2026-02-06T10:00:00.000Z", from: "x@co.com", subject: "Re: A" }),
            ],
          };
        }
        if (threadId === "t-b") {
          // Inbound before last sent -> still unreplied (no inbound after last sent) -> included.
          return {
            messages: [
              mk({ id: "b1", dateIso: "2026-02-01T09:00:00.000Z", from: "y@co.com", subject: "B" }),
              mk({ id: "b2", dateIso: "2026-02-02T09:00:00.000Z", from: "user@example.com", subject: "Re: B", to: "y@co.com" }),
            ],
          };
        }
        // t-c: only sent messages -> included.
        return {
          messages: [
            mk({ id: "c1", dateIso: "2026-02-03T12:00:00.000Z", from: "user@example.com", subject: "C", to: "z@co.com" }),
            mk({ id: "c2", dateIso: "2026-02-04T12:00:00.000Z", from: "user@example.com", subject: "Re: C", to: "z@co.com" }),
          ],
        };
      }),
    };

    const caps = createEmailCapabilities(buildEnv({ emailProvider: provider as never }));
    const result = await caps.searchSent({
      unrepliedToSent: true,
      dateRange: {
        after: "2026-02-01T00:00:00.000Z",
        before: "2026-02-10T00:00:00.000Z",
      },
    });

    expect(provider.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "in:sent",
        sentByMe: true,
      }),
    );

    expect(result.success).toBe(true);
    const items = Array.isArray(result.data) ? result.data : [];
    const threadIds = items.map((i) => i.threadId).sort();
    expect(threadIds).toEqual(["t-b", "t-c"]);
  });
});

