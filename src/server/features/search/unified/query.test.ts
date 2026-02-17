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

  it("rewrites sent-folder conversational search into focused terms", async () => {
    const plan = await planUnifiedSearchQuery({
      userId: "user_1",
      emailAccountId: "acct_1",
      request: {
        query: `Search my sent emails for "portfolio review"`,
      },
    });

    expect(plan.rewrittenQuery).toBe("portfolio review");
    expect(plan.mailbox).toBe("sent");
    expect(plan.scopes).toContain("email");
    expect(plan.queryVariants).toContain("portfolio review");
  });

  it("infers calendar scope for meeting/event phrasing", async () => {
    const plan = await planUnifiedSearchQuery({
      userId: "user_1",
      emailAccountId: "acct_1",
      request: {
        query: "find meetings with Alice next week",
      },
    });

    expect(plan.scopes).toContain("calendar");
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
});
