import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findMatchingRules,
  matchesStaticRule,
  filterMultipleSystemRules,
} from "./match-rules";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import {
  GroupItemType,
  LogicalOperator,
  SystemType,
} from "@/generated/prisma/enums";
import { ConditionType } from "@/server/lib/config";
import {
  getColdEmailRule,
  isColdEmailRuleEnabled,
} from "@/features/cold-email/cold-email-rule";
import { isColdEmail } from "@/features/cold-email/is-cold-email";
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

describe("findMatchingRules - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should detect and return cold email when enabled", async () => {
    const coldEmailRule = getRule({
      id: "cold-email-rule",
      systemType: SystemType.COLD_EMAIL,
    });

    vi.mocked(getColdEmailRule).mockResolvedValue(coldEmailRule);
    vi.mocked(isColdEmailRuleEnabled).mockReturnValue(true);
    vi.mocked(isColdEmail).mockResolvedValue({
      isColdEmail: true,
      reason: "ai",
    });
    vi.mocked(prisma.rule.findUniqueOrThrow).mockResolvedValue(coldEmailRule);

    const rules = [coldEmailRule];
    const message = getMessage({
      headers: getHeaders({ from: "coldemailer@example.com" }),
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

    expect(getColdEmailRule).toHaveBeenCalledWith(emailAccount.id);
    expect(isColdEmailRuleEnabled).toHaveBeenCalledWith(coldEmailRule);
    expect(isColdEmail).toHaveBeenCalledWith({
      email: expect.any(Object),
      emailAccount,
      provider,
      modelType: "default",
      coldEmailRule,
    });

    expect(result.matches[0]?.rule.id).toBe("cold-email-rule");
    expect(result.reasoning).toBe("ai");
  });

  it("should skip cold email detection when rule is not enabled", async () => {
    const coldEmailRule = getRule({
      id: "cold-email-rule",
      systemType: SystemType.COLD_EMAIL,
    });

    const normalRule = getRule({
      id: "normal-rule",
      from: "test@example.com",
    });

    vi.mocked(getColdEmailRule).mockResolvedValue(coldEmailRule);
    vi.mocked(isColdEmailRuleEnabled).mockReturnValue(false);

    const rules = [coldEmailRule, normalRule];
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

    expect(getColdEmailRule).toHaveBeenCalledWith(emailAccount.id);
    expect(isColdEmailRuleEnabled).toHaveBeenCalledWith(coldEmailRule);
    expect(isColdEmail).not.toHaveBeenCalled();

    // Should match the normal rule instead
    expect(result.matches[0]?.rule.id).toBe("normal-rule");
  });

  it("should continue to other rules when email is not cold", async () => {
    const coldEmailRule = getRule({
      id: "cold-email-rule",
      systemType: SystemType.COLD_EMAIL,
    });

    const normalRule = getRule({
      id: "normal-rule",
      from: "test@example.com",
    });

    vi.mocked(getColdEmailRule).mockResolvedValue(coldEmailRule);
    vi.mocked(isColdEmailRuleEnabled).mockReturnValue(true);
    vi.mocked(isColdEmail).mockResolvedValue({
      isColdEmail: false,
      reason: "hasPreviousEmail",
    });

    const rules = [coldEmailRule, normalRule];
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

    expect(isColdEmail).toHaveBeenCalled();

    // Should continue and match the normal rule
    expect(result.matches[0]?.rule.id).toBe("normal-rule");
  });

  it("should match calendar rule when message has .ics attachment", async () => {
    const calendarRule = getRule({
      id: "calendar-rule",
      systemType: SystemType.CALENDAR,
    });

    const rules = [calendarRule];
    const message = getMessage({
      headers: getHeaders(),
      attachments: [
        {
          filename: "meeting.ics",
          mimeType: "text/calendar",
          size: 1024,
          attachmentId: "attachment-1",
          headers: {
            "content-type": "text/calendar",
            "content-description": "",
            "content-transfer-encoding": "",
            "content-id": "",
          },
        },
      ],
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

    expect(result.matches[0]?.rule.id).toBe("calendar-rule");
    expect(result.matches[0]?.matchReasons).toEqual([
      { type: ConditionType.PRESET, systemType: SystemType.CALENDAR },
    ]);
  });

  it("should execute AI rules when potentialAiMatches exist", async () => {
    const aiRule = getRule({
      id: "ai-rule",
      instructions: "Archive promotional emails",
      from: null,
      to: null,
      subject: null,
      body: null,
    });

    vi.mocked(aiChooseRule).mockResolvedValue({
      rules: [{ rule: aiRule as any }],
      reason: "This is a promotional email",
    });

    const rules = [aiRule];
    const message = getMessage();
    const emailAccount = getEmailAccount();

    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider,
      modelType: "default",
      logger,
    });

    expect(aiChooseRule).toHaveBeenCalledWith(
      expect.objectContaining({
        email: expect.any(Object),
        emailAccount,
        modelType: "default",
        rules: expect.arrayContaining([
          expect.objectContaining({
            id: "ai-rule",
            instructions: "Archive promotional emails",
          }),
        ]),
      }),
    );

    expect(result.matches[0]?.rule.id).toBe("ai-rule");
    expect(result.matches[0]?.matchReasons).toEqual([
      { type: ConditionType.AI },
    ]);
    expect(result.reasoning).toBe("This is a promotional email");
  });

  it("should prioritize learned patterns over AI rules", async () => {
    const learnedPatternRule = getRule({
      id: "learned-rule",
      groupId: "group1",
    });

    const aiRule = getRule({
      id: "ai-rule",
      instructions: "Some AI instructions",
    });

    prisma.group.findMany.mockResolvedValue([
      getGroup({
        id: "group1",
        items: [
          getGroupItem({ type: GroupItemType.FROM, value: "test@example.com" }),
        ],
        rule: learnedPatternRule,
      }),
    ]);

    const rules = [learnedPatternRule, aiRule];
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

    // Should match via learned pattern
    expect(result.matches[0]?.rule.id).toBe("learned-rule");
    expect(result.matches[0]?.matchReasons?.[0]?.type).toBe(
      ConditionType.LEARNED_PATTERN,
    );

    // AI should NOT be called because learned pattern matched
    expect(aiChooseRule).not.toHaveBeenCalled();
  });

  it("should skip rules with runOnThreads=false when message is a thread", async () => {
    const threadRule = getRule({
      id: "thread-rule",
      from: "test@example.com",
      runOnThreads: false,
    });

    // Mock provider to return true for isReplyInThread
    const threadProvider = {
      isReplyInThread: vi.fn().mockReturnValue(true),
    } as unknown as EmailProvider;

    // Mock no previously executed rules in thread
    prisma.executedRule.findMany.mockResolvedValue([]);

    const rules = [threadRule];
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }),
    });
    const emailAccount = getEmailAccount();

    const result = await findMatchingRules({
      rules,
      message,
      emailAccount,
      provider: threadProvider,
      modelType: "default",
      logger,
    });

    // Rule should not match because it's a thread and runOnThreads=false
    expect(result.matches).toHaveLength(0);
  });

  describe("filterMultipleSystemRules branches", () => {
    it("returns all system rules when none marked primary (plus conversation rules)", () => {
      const sysA: {
        name: string;
        instructions: string;
        systemType: string | null;
      } = {
        name: "Sys A",
        instructions: "",
        systemType: "TO_REPLY",
      };
      const sysB: {
        name: string;
        instructions: string;
        systemType: string | null;
      } = {
        name: "Sys B",
        instructions: "",
        systemType: "AWAITING_REPLY",
      };
      const conv: {
        name: string;
        instructions: string;
        systemType: string | null;
      } = {
        name: "Conv",
        instructions: "",
        systemType: null,
      };

      const result = filterMultipleSystemRules([
        { rule: sysA, isPrimary: false },
        { rule: sysB },
        { rule: conv },
      ]);

      expect(result).toEqual([sysA, sysB, conv]);
    });

    it("keeps only the primary system rule when multiple system rules present", () => {
      const sysA: {
        name: string;
        instructions: string;
        systemType: string | null;
      } = {
        name: "Sys A",
        instructions: "",
        systemType: "TO_REPLY",
      };
      const sysB: {
        name: string;
        instructions: string;
        systemType: string | null;
      } = {
        name: "Sys B",
        instructions: "",
        systemType: "AWAITING_REPLY",
      };
      const conv: {
        name: string;
        instructions: string;
        systemType: string | null;
      } = {
        name: "Conv",
        instructions: "",
        systemType: null,
      };

      const result = filterMultipleSystemRules([
        { rule: sysA, isPrimary: false },
        { rule: sysB, isPrimary: true },
        { rule: conv },
      ]);

      expect(result).toEqual([sysB, conv]);
    });
  });

  describe("Group rules fallthrough when no groups exist", () => {
    it("falls through to static/AI evaluation when getGroupsWithRules returns empty", async () => {
      const groupRule = getRule({
        id: "group-rule-1",
        from: "group@example.com",
        groupId: "g1",
      });

      // Ensure provider treats this as non-thread
      const providerNoThread = {
        isReplyInThread: vi.fn().mockReturnValue(false),
      } as unknown as EmailProvider;

      // Mock groups to be empty so the code path skips learned pattern branch
      const groupModule = await import("@/features/groups/find-matching-group");
      vi.spyOn(groupModule, "getGroupsWithRules").mockResolvedValue([] as any);

      const rules = [groupRule];
      const message = getMessage({
        headers: getHeaders({ from: "group@example.com" }),
      });
      const emailAccount = getEmailAccount();

      const result = await findMatchingRules({
        rules,
        message,
        emailAccount,
        provider: providerNoThread,
        modelType: "default",
        logger,
      });

      // Should match via static evaluation since groups are empty
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]?.rule.id).toBe("group-rule-1");
    });
  });
  describe("Thread continuity - runOnThreads=false rules", () => {
    it("should continue applying rule in a thread when it was previously applied", async () => {
      const notifRule = getRule({
        id: "notif-rule",
        from: "notif@example.com",
        runOnThreads: false,
      });

      // Mock provider to indicate this is a thread
      const threadProvider = {
        isReplyInThread: vi.fn().mockReturnValue(true),
      } as unknown as EmailProvider;

      // Mock DB to return previously executed rule id
      prisma.executedRule.findMany.mockResolvedValue([
        { ruleId: "notif-rule" },
      ] as any);

      const rules = [notifRule];
      const message = getMessage({
        headers: getHeaders({ from: "notif@example.com" }),
      });
      const emailAccount = getEmailAccount();

      const result = await findMatchingRules({
        rules,
        message,
        emailAccount,
        provider: threadProvider,
        modelType: "default",
        logger,
      });

      expect(prisma.executedRule.findMany).toHaveBeenCalledTimes(1);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]?.rule.id).toBe("notif-rule");
    });

    it("should lazy-load previous rules only once for multiple runOnThreads=false rules", async () => {
      const ruleA = getRule({
        id: "rule-a",
        from: "multi@example.com",
        runOnThreads: false,
      });
      const ruleB = getRule({
        id: "rule-b",
        from: "multi@example.com",
        runOnThreads: false,
      });

      const threadProvider = {
        isReplyInThread: vi.fn().mockReturnValue(true),
      } as unknown as EmailProvider;

      prisma.executedRule.findMany.mockResolvedValue([
        { ruleId: "rule-a" },
        { ruleId: "rule-b" },
      ] as any);

      const rules = [ruleA, ruleB];
      const message = getMessage({
        headers: getHeaders({ from: "multi@example.com" }),
      });
      const emailAccount = getEmailAccount();

      const result = await findMatchingRules({
        rules,
        message,
        emailAccount,
        provider: threadProvider,
        modelType: "default",
        logger,
      });

      expect(prisma.executedRule.findMany).toHaveBeenCalledTimes(1);
      expect(result.matches.map((m) => m.rule.id).sort()).toEqual([
        "rule-a",
        "rule-b",
      ]);
    });

    it("should not query DB when message is not a thread", async () => {
      const notifRule = getRule({
        id: "not-thread",
        from: "no-thread@example.com",
        runOnThreads: false,
      });

      const providerNotThread = {
        isReplyInThread: vi.fn().mockReturnValue(false),
      } as unknown as EmailProvider;

      const rules = [notifRule];
      const message = getMessage({
        headers: getHeaders({ from: "no-thread@example.com" }),
      });
      const emailAccount = getEmailAccount();

      const result = await findMatchingRules({
        rules,
        message,
        emailAccount,
        provider: providerNotThread,
        modelType: "default",
        logger,
      });

      expect(prisma.executedRule.findMany).not.toHaveBeenCalled();
      // Not a thread, so normal matching applies (matches by static from)
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]?.rule.id).toBe("not-thread");
    });

    it("should not query DB when rule has runOnThreads=true (even in a thread)", async () => {
      const threadRule = getRule({
        id: "thread-ok",
        from: "yes-thread@example.com",
        runOnThreads: true,
      });

      const threadProvider = {
        isReplyInThread: vi.fn().mockReturnValue(true),
      } as unknown as EmailProvider;

      const rules = [threadRule];
      const message = getMessage({
        headers: getHeaders({ from: "yes-thread@example.com" }),
      });
      const emailAccount = getEmailAccount();

      const result = await findMatchingRules({
        rules,
        message,
        emailAccount,
        provider: threadProvider,
        modelType: "default",
        logger,
      });

      expect(prisma.executedRule.findMany).not.toHaveBeenCalled();
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]?.rule.id).toBe("thread-ok");
    });
  });

  it("should handle invalid regex patterns gracefully", () => {
    const rule = getRule({
      from: "[invalid(regex",
    });

    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }),
    });

    // Should not throw, just return false
    expect(() => matchesStaticRule(rule, message, logger)).not.toThrow();
    const result = matchesStaticRule(rule, message, logger);
    expect(result).toBe(false);
  });

  it("should combine static match with AI potentialMatch correctly", async () => {
    const mixedRule = getRule({
      id: "mixed-rule",
      from: "test@example.com",
      instructions: "Archive if promotional",
      conditionalOperator: LogicalOperator.AND,
    });

    vi.mocked(aiChooseRule).mockResolvedValue({
      rules: [{ rule: mixedRule as any }],
      reason: "Email is promotional",
    });

    const rules = [mixedRule];
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

    // Static matched, so should be sent to AI for AND check
    expect(aiChooseRule).toHaveBeenCalled();
    expect(result.matches[0]?.rule.id).toBe("mixed-rule");
  });

  it("merges static match with AI rule and combines reasoning text", async () => {
    const staticRule = getRule({
      id: "static-rule-1",
      from: "reason@example.com",
    });
    const aiOnlyRule = getRule({ id: "ai-rule-2", instructions: "Do X" });

    // Ensure potentialAiMatches includes aiOnlyRule
    vi.mocked(aiChooseRule).mockResolvedValue({
      rules: [aiOnlyRule as any],
      reason: "AI reasoning here",
    });

    const rules = [staticRule, aiOnlyRule];
    const message = getMessage({
      headers: getHeaders({ from: "reason@example.com" }),
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

    // Reasoning should combine existing matchReasons text + AI reason
    // existing part comes from getMatchReason => "Matched static conditions"
    expect(result.reasoning).toBe(
      "Matched static conditions; AI reasoning here",
    );
  });

  it("matchesStaticRule: catches RegExp construction error and returns false", () => {
    const rule = getRule({ from: "trigger-error" });
    const message = getMessage({
      headers: getHeaders({ from: "any@example.com" }),
    });

    const OriginalRegExp = RegExp;
    // Monkeypatch RegExp to throw for our specific pattern
    // Only for this test; restore afterwards
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).RegExp = ((pattern: string) => {
      if (pattern.includes("trigger-error")) {
        throw new Error("synthetic error");
      }
      // Delegate to original
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new (OriginalRegExp as any)(pattern);
    }) as unknown as RegExpConstructor;

    try {
      const matched = matchesStaticRule(rule as any, message as any, logger);
      expect(matched).toBe(false);
    } finally {
      // restore
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).RegExp =
        OriginalRegExp as unknown as RegExpConstructor;
    }
  });

  it("AI path: returns only AI reasoning when no static matches and AI returns no rules", async () => {
    const aiOnlyRule = getRule({ id: "ai-only-1", instructions: "Do Y" });

    vi.mocked(aiChooseRule).mockResolvedValue({
      rules: [],
      reason: "AI had reasoning but selected nothing",
    });

    const rules = [aiOnlyRule];
    const message = getMessage({
      // No static matchers
      headers: getHeaders({ from: "nobody@example.com" }),
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

    expect(result.matches.map((m) => m.rule.id)).toEqual([]);
    expect(result.reasoning).toBe("AI had reasoning but selected nothing");
  });

  it("AI path: dedups AI-selected rule when it duplicates a static match", async () => {
    const dupRule = getRule({
      id: "dup-rule",
      from: "dup@example.com",
      instructions: "Use AI too",
      runOnThreads: true,
    });

    vi.mocked(aiChooseRule).mockResolvedValue({
      rules: [{ rule: dupRule as any }],
      reason: "AI selects dup-rule",
    });

    const rules = [dupRule];
    const message = getMessage({
      headers: getHeaders({ from: "dup@example.com" }),
    });
    const emailAccount = getEmailAccount();

    const spy = vi.spyOn(provider, "isReplyInThread").mockReturnValue(false);
    try {
      const result = await findMatchingRules({
        rules,
        message,
        emailAccount,
        provider,
        modelType: "default",
        logger,
      });

      // Only one occurrence of dup-rule should remain
      const ids = result.matches.map((m) => m.rule.id);
      expect(ids).toEqual(["dup-rule"]);
      expect(result.reasoning).toContain("AI selects dup-rule");
    } finally {
      spy.mockRestore();
    }
  });
});
