import { describe, it, expect, vi, beforeEach } from "vitest";
import { findMatchingRules } from "./match-rules";
import { GroupItemType, LogicalOperator } from "@/generated/prisma/enums";
import { ConditionType } from "@/server/lib/config";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import {
  logger,
  provider,
  prisma,
  getRule,
  getHeaders,
  getMessage,
  getGroup,
  getGroupItem,
  getEmailAccount,
} from "./match-rules.test-helpers";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client");
vi.mock("@/features/rules/ai/ai-choose-rule", () => ({ aiChooseRule: vi.fn() }));
vi.mock("@/features/reply-tracker/check-sender-reply-history", () => ({
  checkSenderReplyHistory: vi.fn(),
}));
vi.mock("@/features/cold-email/cold-email-rule", () => ({
  getColdEmailRule: vi.fn(),
  isColdEmailRuleEnabled: vi.fn(),
}));
vi.mock("@/features/cold-email/is-cold-email", () => ({ isColdEmail: vi.fn() }));

describe("findMatchingRule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("matches a static rule", async () => {
    const rule = getRule({ from: "test@example.com" });
    const rules = [rule];
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }),
    });
    const emailAccount = getEmailAccount();
    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider,
      modelType: "default",
      logger,
    });

    expect(result.matches[0].rule.id).toBe(rule.id);
    expect(result.matches[0].matchReasons).toEqual([
      { type: ConditionType.STATIC },
    ]);
  });

  it("matches a static domain", async () => {
    const rule = getRule({ from: "@example.com" });
    const rules = [rule];
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }),
    });
    const emailAccount = getEmailAccount();

    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider,
      modelType: "default",
      logger,
    });

    expect(result.matches[0].rule.id).toBe(rule.id);
    expect(result.matches[0].matchReasons).toEqual([
      { type: ConditionType.STATIC },
    ]);
  });

  it("doens't match wrong static domain", async () => {
    const rule = getRule({ from: "@example2.com" });
    const rules = [rule];
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }),
    });
    const emailAccount = getEmailAccount();

    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider,
      modelType: "default",
      logger,
    });

    expect(result.matches).toHaveLength(0);
    expect(result.reasoning).toBe("");
  });

  it("matches a group rule", async () => {
    const rule = getRule({ groupId: "group1" });

    prisma.group.findMany.mockResolvedValue([
      getGroup({
        id: "group1",
        items: [
          getGroupItem({ type: GroupItemType.FROM, value: "test@example.com" }),
        ],
        rule,
      }),
    ]);

    const rules = [rule];
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }),
    });
    const emailAccount = getEmailAccount();

    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider,
      modelType: "default",
      logger,
    });

    expect(result.matches[0]?.rule.id).toBe(rule.id);
    expect(result.reasoning).toBe(
      `Matched learned pattern: "FROM: test@example.com"`,
    );
  });

  it("should NOT match when group doesn't match and no other conditions", async () => {
    const rule = getRule({
      groupId: "correctGroup", // Rule specifically looks for correctGroup
    });

    // Set up groups - message doesn't match the rule's group
    prisma.group.findMany.mockResolvedValue([
      getGroup({
        id: "wrongGroup",
        items: [
          getGroupItem({
            groupId: "wrongGroup",
            type: GroupItemType.FROM,
            value: "test@example.com",
          }),
        ],
      }),
      getGroup({
        id: "correctGroup",
        items: [
          getGroupItem({
            groupId: "correctGroup",
            type: GroupItemType.FROM,
            value: "wrong@example.com",
          }),
        ],
        rule,
      }),
    ]);

    const rules = [rule];
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }), // Doesn't match correctGroup
    });
    const emailAccount = getEmailAccount();

    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider,
      modelType: "default",
      logger,
    });

    // Group didn't match and no other conditions, so rule should NOT match
    expect(result.matches).toHaveLength(0);
  });

  it("should match only when item is in the correct group", async () => {
    const rule = getRule({ groupId: "correctGroup" });

    // Set up two groups with similar items
    prisma.group.findMany.mockResolvedValue([
      getGroup({
        id: "correctGroup",
        items: [
          getGroupItem({
            groupId: "correctGroup",
            type: GroupItemType.FROM,
            value: "test@example.com",
          }),
        ],
        rule,
      }),
      getGroup({
        id: "otherGroup",
        items: [
          getGroupItem({
            groupId: "otherGroup",
            type: GroupItemType.FROM,
            value: "test@example.com", // Same value, different group
          }),
        ],
      }),
    ]);

    const rules = [rule];
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }),
    });
    const emailAccount = getEmailAccount();

    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider,
      modelType: "default",
      logger,
    });

    expect(result.matches[0]?.rule.id).toBe(rule.id);
    expect(result.reasoning).toContain("test@example.com");
  });

  it("should handle multiple rules with different group conditions correctly", async () => {
    const rule1 = getRule({ id: "rule1", groupId: "group1" });
    const rule2 = getRule({ id: "rule2", groupId: "group2" });

    prisma.group.findMany.mockResolvedValue([
      getGroup({
        id: "group1",
        items: [
          getGroupItem({
            groupId: "group1",
            type: GroupItemType.FROM,
            value: "test@example.com",
          }),
        ],
        rule: rule1,
      }),
      getGroup({
        id: "group2",
        items: [
          getGroupItem({
            groupId: "group2",
            type: GroupItemType.FROM,
            value: "test@example.com",
          }),
        ],
        rule: rule2,
      }),
    ]);

    const rules = [rule1, rule2];
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }),
    });
    const emailAccount = getEmailAccount();

    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider,
      modelType: "default",
      logger,
    });

    // Should match the first rule only
    expect(result.matches[0]?.rule.id).toBe("rule1");
    expect(result.reasoning).toContain("test@example.com");
  });

  it("should only match rules whose group actually contains the pattern (bug regression test)", async () => {
    // Regression: Ensure rules only match when their specific group pattern matches,
    // not when other unrelated groups have matching patterns
    const ruleA = getRule({
      id: "rule-a",
      name: "Label Acme Emails",
      groupId: "group-a",
    });
    const ruleB = getRule({
      id: "rule-b",
      name: "Label Beta Emails",
      groupId: "group-b",
    });
    const ruleC = getRule({
      id: "rule-c",
      name: "Label Charlie Emails",
      groupId: "group-c",
    });
    const ruleD = getRule({
      id: "rule-d",
      name: "Label Delta Emails",
      groupId: "group-d",
    });

    prisma.group.findMany.mockResolvedValue([
      getGroup({
        id: "group-a",
        name: "Label Acme Emails",
        items: [
          getGroupItem({
            groupId: "group-a",
            type: GroupItemType.FROM,
            value: "alerts@acme.com",
          }),
        ],
        rule: ruleA,
      }),
      getGroup({
        id: "group-b",
        name: "Label Beta Emails",
        items: [
          getGroupItem({
            groupId: "group-b",
            type: GroupItemType.FROM,
            value: "notifications@beta.com",
          }),
        ],
        rule: ruleB,
      }),
      getGroup({
        id: "group-c",
        name: "Label Charlie Emails",
        items: [
          getGroupItem({
            groupId: "group-c",
            type: GroupItemType.FROM,
            value: "support@charlie.com",
          }),
        ],
        rule: ruleC,
      }),
      getGroup({
        id: "group-d",
        name: "Label Delta Emails",
        items: [
          getGroupItem({
            groupId: "group-d",
            type: GroupItemType.FROM,
            value: "info@delta.com",
          }),
        ],
        rule: ruleD,
      }),
    ]);

    const rules = [ruleA, ruleB, ruleC, ruleD];
    const message = getMessage({
      headers: getHeaders({ from: "alerts@acme.com" }),
    });
    const emailAccount = getEmailAccount();

    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider,
      modelType: "default",
      logger,
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.rule.id).toBe("rule-a");
    expect(result.matches[0]?.rule.name).toBe("Label Acme Emails");
    expect(result.reasoning).toContain("alerts@acme.com");

    const matchedRuleIds = result.matches.map((m) => m.rule.id);
    expect(matchedRuleIds).not.toContain("rule-b");
    expect(matchedRuleIds).not.toContain("rule-c");
    expect(matchedRuleIds).not.toContain("rule-d");
  });

  it("should exclude a rule when an exclusion pattern matches", async () => {
    const rule = getRule({
      id: "rule-with-exclusion",
      groupId: "group-with-exclusion",
    });

    // Set up a group with an exclusion pattern
    prisma.group.findMany.mockResolvedValue([
      getGroup({
        id: "group-with-exclusion",
        items: [
          getGroupItem({
            groupId: "group-with-exclusion",
            type: GroupItemType.FROM,
            value: "test@example.com",
            exclude: true, // This is an exclusion pattern
          }),
        ],
        rule,
      }),
    ]);

    const rules = [rule];
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }), // This matches the exclusion pattern
    });
    const emailAccount = getEmailAccount();

    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider,
      modelType: "default",
      logger,
    });

    // The rule should be excluded (not matched)
    expect(result.matches).toHaveLength(0);
    expect(result.reasoning).toBe("");
  });

  it("should match via static condition when group rule doesn't match pattern (OR operator)", async () => {
    const rule = getRule({
      id: "group-with-fallback",
      groupId: "test-group",
      from: "fallback@example.com", // Static condition
      conditionalOperator: LogicalOperator.OR,
    });

    // Group has different pattern
    prisma.group.findMany.mockResolvedValue([
      getGroup({
        id: "test-group",
        items: [
          getGroupItem({
            type: GroupItemType.FROM,
            value: "group@example.com",
          }),
        ],
        rule,
      }),
    ]);

    const rules = [rule];
    const message = getMessage({
      headers: getHeaders({ from: "fallback@example.com" }), // Matches static, not group
    });
    const emailAccount = getEmailAccount();

    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider,
      modelType: "default",
      logger,
    });

    expect(result.matches[0]?.rule.id).toBe(rule.id);
    expect(result.matches[0]?.matchReasons).toEqual([
      { type: ConditionType.STATIC },
    ]);
  });

  it("should match via static when group rule has group miss and static hit (AND operator)", async () => {
    const rule = getRule({
      id: "group-with-and",
      groupId: "test-group",
      from: "test@example.com", // Static condition
      conditionalOperator: LogicalOperator.AND, // Only applies to AI/Static, not groups
    });

    // Group has different pattern
    prisma.group.findMany.mockResolvedValue([
      getGroup({
        id: "test-group",
        items: [
          getGroupItem({
            type: GroupItemType.FROM,
            value: "group@example.com",
          }),
        ],
        rule,
      }),
    ]);

    const rules = [rule];
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }), // Matches static, not group
    });
    const emailAccount = getEmailAccount();

    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider,
      modelType: "default",
      logger,
    });

    // Groups are independent of AND/OR operator - static match should work
    expect(result.matches[0]?.rule.id).toBe(rule.id);
    expect(result.matches[0]?.matchReasons).toEqual([
      { type: ConditionType.STATIC },
    ]);
  });

  it("should match when group rule with AND operator has both group and static match", async () => {
    const rule = getRule({
      id: "group-with-and-both",
      groupId: "test-group",
      subject: "Important", // Additional static condition
      conditionalOperator: LogicalOperator.AND,
    });

    prisma.group.findMany.mockResolvedValue([
      getGroup({
        id: "test-group",
        items: [
          getGroupItem({ type: GroupItemType.FROM, value: "test@example.com" }),
        ],
        rule,
      }),
    ]);

    const rules = [rule];
    const message = getMessage({
      headers: getHeaders({
        from: "test@example.com", // Matches group
        subject: "Important update", // Matches static
      }),
    });
    const emailAccount = getEmailAccount();

    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider,
      modelType: "default",
      logger,
    });

    // Should match via learned pattern and short-circuit (not check static)
    expect(result.matches[0]?.rule.id).toBe(rule.id);
    expect(result.matches[0]?.matchReasons).toEqual([
      {
        type: ConditionType.LEARNED_PATTERN,
        groupItem: expect.objectContaining({
          type: GroupItemType.FROM,
          value: "test@example.com",
        }),
        group: expect.objectContaining({ id: "test-group" }),
      },
    ]);
  });

  it("should match learned pattern when email has display name format", async () => {
    const rule = getRule({
      id: "rule-with-display-name",
      groupId: "group-with-display-name",
      instructions:
        "This is an AI instruction; should not be used if group matches.",
      conditionalOperator: LogicalOperator.OR,
    });

    // Set up a group with a learned pattern for just the email address
    prisma.group.findMany.mockResolvedValue([
      getGroup({
        id: "group-with-display-name",
        items: [
          getGroupItem({
            groupId: "group-with-display-name",
            type: GroupItemType.FROM,
            value: "central@example.com",
          }),
        ],
        rule,
      }),
    ]);
    (aiChooseRule as ReturnType<typeof vi.fn>).mockClear();

    const rules = [rule];
    const message = getMessage({
      headers: getHeaders({
        from: "Central Channel <central@example.com>",
        subject: "A benign subject",
      }),
    });
    const emailAccount = getEmailAccount();

    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider,
      modelType: "default",
      logger,
    });

    // Should match despite the display name format, due to the group rule
    expect(result.matches[0]?.rule.id).toBe(rule.id);
    expect(result.reasoning).toBe(
      `Matched learned pattern: "FROM: central@example.com"`,
    );
    expect(aiChooseRule).not.toHaveBeenCalled();
  });
});
