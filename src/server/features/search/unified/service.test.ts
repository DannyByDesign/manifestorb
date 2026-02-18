import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUnifiedSearchService } from "@/server/features/search/unified/service";
import { planUnifiedSearchQuery } from "@/server/features/search/unified/query";
import {
  getSearchBehaviorScores,
  listRecentIndexedDocuments,
  recordSearchSignals,
  searchIndexedDocuments,
} from "@/server/features/search/index/repository";

vi.mock("@/server/features/search/unified/query", () => ({
  planUnifiedSearchQuery: vi.fn(),
}));

vi.mock("@/server/features/search/index/repository", () => ({
  getSearchBehaviorScores: vi.fn(async () => []),
  listRecentIndexedDocuments: vi.fn(async () => []),
  recordSearchSignals: vi.fn(async () => {}),
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
        search: vi.fn(async () => ({ messages: [], nextPageToken: null })),
      } as never,
      calendar: {} as never,
    },
  });
}

describe("unified search service hard constraints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(searchIndexedDocuments).mockResolvedValue([]);
    vi.mocked(getSearchBehaviorScores).mockResolvedValue([]);
    vi.mocked(recordSearchSignals).mockResolvedValue(undefined);
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

    vi.mocked(listRecentIndexedDocuments).mockResolvedValue([
      {
        id: "doc_1",
        connector: "email",
        sourceType: "message",
        sourceId: "m_older_unread",
        sourceParentId: "t_older_unread",
        title: "Older unread",
        snippet: "one",
        bodyText: "one",
        url: null,
        authorIdentity: "a@example.com",
        occurredAt: new Date("2025-01-10T10:00:00.000Z"),
        startAt: null,
        endAt: null,
        updatedSourceAt: new Date("2025-01-10T10:00:00.000Z"),
        freshnessScore: 0.2,
        authorityScore: 0.5,
        metadata: {
          mailbox: "inbox",
          labelIds: ["INBOX", "UNREAD"],
          isInbox: true,
          isUnread: true,
          messageId: "m_older_unread",
          threadId: "t_older_unread",
        },
      },
      {
        id: "doc_2",
        connector: "email",
        sourceType: "message",
        sourceId: "m_read_newer",
        sourceParentId: "t_read_newer",
        title: "Read newer",
        snippet: "two",
        bodyText: "two",
        url: null,
        authorIdentity: "b@example.com",
        occurredAt: new Date("2026-01-10T10:00:00.000Z"),
        startAt: null,
        endAt: null,
        updatedSourceAt: new Date("2026-01-10T10:00:00.000Z"),
        freshnessScore: 1,
        authorityScore: 0.5,
        metadata: {
          mailbox: "inbox",
          labelIds: ["INBOX"],
          isInbox: true,
          isUnread: false,
          messageId: "m_read_newer",
          threadId: "t_read_newer",
        },
      },
      {
        id: "doc_3",
        connector: "email",
        sourceType: "message",
        sourceId: "m_newest_unread",
        sourceParentId: "t_newest_unread",
        title: "Newest unread",
        snippet: "three",
        bodyText: "three",
        url: null,
        authorIdentity: "c@example.com",
        occurredAt: new Date("2026-02-10T10:00:00.000Z"),
        startAt: null,
        endAt: null,
        updatedSourceAt: new Date("2026-02-10T10:00:00.000Z"),
        freshnessScore: 1,
        authorityScore: 0.5,
        metadata: {
          mailbox: "inbox",
          labelIds: ["INBOX", "UNREAD"],
          isInbox: true,
          isUnread: true,
          messageId: "m_newest_unread",
          threadId: "t_newest_unread",
        },
      },
    ]);

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
});
