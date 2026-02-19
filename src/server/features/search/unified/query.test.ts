import { describe, expect, it, vi, beforeEach } from "vitest";
import { planUnifiedSearchQuery } from "@/server/features/search/unified/query";
import { lookupSearchAliasExpansions } from "@/server/features/search/index/repository";

vi.mock("@/server/features/search/index/repository", () => ({
  lookupSearchAliasExpansions: vi.fn(async () => []),
}));

describe("unified search query planner", () => {
  beforeEach(() => {
    vi.mocked(lookupSearchAliasExpansions).mockReset();
    vi.mocked(lookupSearchAliasExpansions).mockResolvedValue([]);
  });

  it("preserves raw query text when semantic compiler is unavailable", async () => {
    const query = `Search my sent emails for "portfolio review"`;
    const plan = await planUnifiedSearchQuery({
      userId: "user_1",
      emailAccountId: "acct_1",
      request: {
        query,
        mailbox: "sent",
      },
    });

    expect(plan.rewrittenQuery).toBe(query);
    expect(plan.mailbox).toBe("sent");
    expect(plan.scopes).toContain("email");
    expect(plan.queryVariants).toContain(query);
  });

  it("defaults to all scopes when none are explicitly provided", async () => {
    const plan = await planUnifiedSearchQuery({
      userId: "user_1",
      emailAccountId: "acct_1",
      request: {
        query: "find meetings with Alice next week",
      },
    });

    expect(plan.scopes).toContain("email");
    expect(plan.scopes).toContain("calendar");
    expect(plan.scopes).toContain("rule");
    expect(plan.scopes).toContain("memory");
  });

  it("expands alias terms from indexed alias table", async () => {
    vi.mocked(lookupSearchAliasExpansions).mockResolvedValue([
      {
        entityType: "person",
        aliasValue: "danny",
        canonicalValue: "danny.wang@example.com",
        confidence: 0.9,
      },
    ]);

    const plan = await planUnifiedSearchQuery({
      userId: "user_1",
      emailAccountId: "acct_1",
      request: {
        query: "emails from danny",
      },
    });

    expect(plan.aliasExpansions).toContain("danny.wang@example.com");
    expect(plan.queryVariants.join(" ")).toContain("danny.wang@example.com");
  });

  it("does not synthesize nickname variants heuristically", async () => {
    const plan = await planUnifiedSearchQuery({
      userId: "user_1",
      emailAccountId: "acct_1",
      request: {
        query: "email from danny",
      },
    });

    expect(plan.terms).toContain("danny");
    expect(plan.terms).not.toContain("daniel");
    expect(plan.queryVariants.join(" ")).not.toContain("daniel");
  });

  it("passes through explicit structured constraints without heuristic inference", async () => {
    const plan = await planUnifiedSearchQuery({
      userId: "user_1",
      emailAccountId: "acct_1",
      request: {
        query: "anything",
        scopes: ["email"],
        mailbox: "inbox",
        unread: true,
        sort: "newest",
        hasAttachment: true,
        limit: 10,
      },
    });

    expect(plan.mailbox).toBe("inbox");
    expect(plan.unread).toBe(true);
    expect(plan.sort).toBe("newest");
    expect(plan.hasAttachment).toBe(true);
    expect(plan.inferredLimit).toBe(10);
  });

  it("does not force oldest ordering from positional phrasing alone", async () => {
    const plan = await planUnifiedSearchQuery({
      userId: "user_1",
      emailAccountId: "acct_1",
      request: {
        query: "what's the first unread email in my inbox?",
        scopes: ["email"],
        unread: true,
      },
    });

    expect(plan.sort).toBeUndefined();
  });

  it("defaults email search to inbox + primary when mailbox/category are unspecified", async () => {
    const plan = await planUnifiedSearchQuery({
      userId: "user_1",
      emailAccountId: "acct_1",
      request: {
        query: "find unread messages from Alice",
        scopes: ["email"],
        unread: true,
      },
    });

    expect(plan.mailbox).toBe("inbox");
    expect(plan.category).toBe("primary");
    expect(plan.mailboxExplicit).toBe(false);
    expect(plan.categoryExplicit).toBe(false);
  });

  it("honors explicit mailbox/category without applying inbox/primary defaults", async () => {
    const plan = await planUnifiedSearchQuery({
      userId: "user_1",
      emailAccountId: "acct_1",
      request: {
        query: "search sent promotions",
        scopes: ["email"],
        mailbox: "sent",
        category: "promotions",
      },
    });

    expect(plan.mailbox).toBe("sent");
    expect(plan.category).toBe("promotions");
    expect(plan.mailboxExplicit).toBe(true);
    expect(plan.categoryExplicit).toBe(true);
  });

  it("keeps category unset for explicit mailbox=all when category is unspecified", async () => {
    const plan = await planUnifiedSearchQuery({
      userId: "user_1",
      emailAccountId: "acct_1",
      request: {
        query: "search all emails about invoice",
        scopes: ["email"],
        mailbox: "all",
      },
    });

    expect(plan.mailbox).toBe("all");
    expect(plan.category).toBeUndefined();
    expect(plan.mailboxExplicit).toBe(true);
    expect(plan.categoryExplicit).toBe(false);
  });
});
