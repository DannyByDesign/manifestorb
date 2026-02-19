import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUnifiedSearchService } from "@/server/features/search/unified/service";
import { planUnifiedSearchQuery } from "@/server/features/search/unified/query";
import { listRecentIndexedDocuments, searchIndexedDocuments } from "@/server/features/search/index/repository";

vi.mock("@/server/features/search/unified/query", () => ({
  planUnifiedSearchQuery: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  default: {
    canonicalRule: {
      findMany: vi.fn(async () => []),
    },
  },
}));

vi.mock("@/server/features/search/index/repository", () => ({
  listRecentIndexedDocuments: vi.fn(async () => []),
  searchIndexedDocuments: vi.fn(async () => []),
}));

vi.mock("@/server/features/search/unified/ranking", () => ({
  rankDocuments: vi.fn(async ({ docs }: { docs: Array<Record<string, unknown>> }) =>
    docs.map((doc, index) => ({
      doc,
      score: Math.max(0, 1 - index * 0.05),
      lexicalScore: 0.5,
      semanticScore: 0.4,
      features: {
        lexical: 0.5,
        semantic: 0.4,
        freshness: 0.5,
        authority: 0.5,
        intentSurface: 0.5,
        behavior: 0,
        graphProximity: 0,
        final: Math.max(0, 1 - index * 0.05),
      },
    })),
  ),
}));

const emailSearchMock = vi.fn(async () => ({ messages: [], nextPageToken: null }));

function buildService() {
  return createUnifiedSearchService({
    userId: "user_1",
    emailAccountId: "acct_1",
    email: "user@example.com",
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      with: vi.fn().mockReturnThis(),
    } as never,
    providers: {
      email: {
        name: "google",
        search: emailSearchMock,
      } as never,
      calendar: {
        searchEvents: vi.fn(async () => []),
      } as never,
    },
  });
}

describe("unified search service hard constraints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    emailSearchMock.mockResolvedValue({ messages: [], nextPageToken: null });
    vi.mocked(searchIndexedDocuments).mockResolvedValue([]);
    vi.mocked(listRecentIndexedDocuments).mockResolvedValue([]);
  });

  it("enforces unread newest ordering regardless of ranking preference", async () => {
    vi.mocked(planUnifiedSearchQuery).mockResolvedValue({
      query: "Show me my 10 most recent unread emails",
      rewrittenQuery: "",
      queryVariants: [],
      scopes: ["email"],
      mailbox: "inbox",
      sort: "newest",
      unread: true,
      hasAttachment: undefined,
      inferredLimit: 10,
      aliasExpansions: [],
      terms: [],
    });

    emailSearchMock.mockResolvedValue({
      messages: [
        {
          id: "m_older_unread",
          threadId: "t_older_unread",
          subject: "Older unread",
          snippet: "one",
          date: new Date("2025-01-10T10:00:00.000Z"),
          labelIds: ["INBOX", "UNREAD"],
          headers: { from: "a@example.com" },
          attachments: [],
        },
        {
          id: "m_read_newer",
          threadId: "t_read_newer",
          subject: "Read newer",
          snippet: "two",
          date: new Date("2026-01-10T10:00:00.000Z"),
          labelIds: ["INBOX"],
          headers: { from: "b@example.com" },
          attachments: [],
        },
        {
          id: "m_newest_unread",
          threadId: "t_newest_unread",
          subject: "Newest unread",
          snippet: "three",
          date: new Date("2026-02-10T10:00:00.000Z"),
          labelIds: ["INBOX", "UNREAD"],
          headers: { from: "c@example.com" },
          attachments: [],
        },
      ],
      nextPageToken: null,
    });

    const service = buildService();
    const result = await service.query({
      query: "Show me my 10 most recent unread emails",
      scopes: ["email"],
      mailbox: "inbox",
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.id).toBe("email:m_newest_unread");
    expect(result.items[1]?.id).toBe("email:m_older_unread");
    expect(result.queryPlan?.unread).toBe(true);
    expect(result.queryPlan?.sort).toBe("newest");
  });

  it("defaults email-only mailbox retrieval to newest when sort is omitted", async () => {
    vi.mocked(planUnifiedSearchQuery).mockResolvedValue({
      query: "what's the first unread email in my inbox?",
      rewrittenQuery: "",
      queryVariants: [],
      scopes: ["email"],
      mailbox: "inbox",
      sort: undefined,
      unread: true,
      hasAttachment: undefined,
      inferredLimit: 1,
      aliasExpansions: [],
      terms: [],
    });

    emailSearchMock.mockResolvedValue({
      messages: [
        {
          id: "m_old_unread",
          threadId: "t_old_unread",
          subject: "Older unread",
          snippet: "old",
          date: new Date("2025-01-14T09:17:00.000Z"),
          labelIds: ["INBOX", "UNREAD"],
          headers: { from: "old@example.com" },
          attachments: [],
        },
        {
          id: "m_new_unread",
          threadId: "t_new_unread",
          subject: "Newest unread",
          snippet: "new",
          date: new Date("2026-02-19T03:27:00.000Z"),
          labelIds: ["INBOX", "UNREAD"],
          headers: { from: "new@example.com" },
          attachments: [],
        },
      ],
      nextPageToken: null,
    });

    const service = buildService();
    const result = await service.query({
      query: "what's the first unread email in my inbox?",
      scopes: ["email"],
      mailbox: "inbox",
      unread: true,
      limit: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe("email:m_new_unread");
    expect(result.queryPlan?.sort).toBe("newest");
  });

  it("defaults inbox searches to primary inbox scope unless user explicitly broadens scope", async () => {
    vi.mocked(planUnifiedSearchQuery).mockResolvedValue({
      query: "what's the first email in my inbox",
      rewrittenQuery: "",
      queryVariants: [],
      scopes: ["email"],
      mailbox: "inbox",
      sort: "newest",
      unread: undefined,
      hasAttachment: undefined,
      category: "primary",
      categoryExplicit: false,
      inferredLimit: 1,
      aliasExpansions: [],
      terms: [],
    });

    emailSearchMock.mockResolvedValue({ messages: [], nextPageToken: null });

    const service = buildService();
    await service.query({
      query: "what's the first email in my inbox",
      scopes: ["email"],
      mailbox: "inbox",
      limit: 1,
    });

    expect(emailSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        includeNonPrimary: false,
        category: "primary",
      }),
    );
  });
});
