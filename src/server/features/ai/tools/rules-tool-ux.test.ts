import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  emailAccountFindUniqueMock,
  ruleDeleteMock,
  listApprovalRuleConfigsMock,
  resolveApprovalRuleReferenceMock,
  disableApprovalRuleMock,
  enableApprovalRuleMock,
  renameApprovalRuleMock,
  removeApprovalRuleMock,
  upsertApprovalRuleMock,
  setApprovalToolDefaultPolicyMock,
  resetApprovalRuleConfigMock,
  listEmailRulesMock,
  resolveEmailRuleReferenceMock,
  resumePausedEmailRulesMock,
  temporarilyDisableEmailRuleMock,
  enableEmailRuleMock,
  renameEmailRuleMock,
  listCalendarPolicyRulesMock,
  resolveCalendarPolicyRuleReferenceMock,
  disableCalendarPolicyRuleMock,
  enableCalendarPolicyRuleMock,
  renameCalendarPolicyRuleMock,
  removeCalendarPolicyRuleMock,
  upsertCalendarPolicyRuleMock,
} = vi.hoisted(() => ({
  emailAccountFindUniqueMock: vi.fn(),
  ruleDeleteMock: vi.fn(),
  listApprovalRuleConfigsMock: vi.fn(),
  resolveApprovalRuleReferenceMock: vi.fn(),
  disableApprovalRuleMock: vi.fn(),
  enableApprovalRuleMock: vi.fn(),
  renameApprovalRuleMock: vi.fn(),
  removeApprovalRuleMock: vi.fn(),
  upsertApprovalRuleMock: vi.fn(),
  setApprovalToolDefaultPolicyMock: vi.fn(),
  resetApprovalRuleConfigMock: vi.fn(),
  listEmailRulesMock: vi.fn(),
  resolveEmailRuleReferenceMock: vi.fn(),
  resumePausedEmailRulesMock: vi.fn(),
  temporarilyDisableEmailRuleMock: vi.fn(),
  enableEmailRuleMock: vi.fn(),
  renameEmailRuleMock: vi.fn(),
  listCalendarPolicyRulesMock: vi.fn(),
  resolveCalendarPolicyRuleReferenceMock: vi.fn(),
  disableCalendarPolicyRuleMock: vi.fn(),
  enableCalendarPolicyRuleMock: vi.fn(),
  renameCalendarPolicyRuleMock: vi.fn(),
  removeCalendarPolicyRuleMock: vi.fn(),
  upsertCalendarPolicyRuleMock: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  default: {
    emailAccount: {
      findUnique: emailAccountFindUniqueMock,
    },
    rule: {
      delete: ruleDeleteMock,
    },
    knowledge: {
      create: vi.fn(),
    },
    group: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/features/approvals/rules", () => ({
  listApprovalRuleConfigs: listApprovalRuleConfigsMock,
  resolveApprovalRuleReference: resolveApprovalRuleReferenceMock,
  disableApprovalRule: disableApprovalRuleMock,
  enableApprovalRule: enableApprovalRuleMock,
  renameApprovalRule: renameApprovalRuleMock,
  removeApprovalRule: removeApprovalRuleMock,
  upsertApprovalRule: upsertApprovalRuleMock,
  setApprovalToolDefaultPolicy: setApprovalToolDefaultPolicyMock,
  resetApprovalRuleConfig: resetApprovalRuleConfigMock,
  listApprovalOperationKeys: () => ["send_email", "delete_email"],
  getApprovalOperationLabel: (operation: string) =>
    operation === "send_email" ? "Send email" : operation,
  normalizeApprovalOperationKey: (operation?: string) => operation,
}));

vi.mock("@/features/rules/management", () => ({
  listEmailRules: listEmailRulesMock,
  resolveEmailRuleReference: resolveEmailRuleReferenceMock,
  resumePausedEmailRules: resumePausedEmailRulesMock,
  temporarilyDisableEmailRule: temporarilyDisableEmailRuleMock,
  enableEmailRule: enableEmailRuleMock,
  renameEmailRule: renameEmailRuleMock,
}));

vi.mock("@/features/calendar/policy-rules", () => ({
  listCalendarPolicyRules: listCalendarPolicyRulesMock,
  resolveCalendarPolicyRuleReference: resolveCalendarPolicyRuleReferenceMock,
  disableCalendarPolicyRule: disableCalendarPolicyRuleMock,
  enableCalendarPolicyRule: enableCalendarPolicyRuleMock,
  renameCalendarPolicyRule: renameCalendarPolicyRuleMock,
  removeCalendarPolicyRule: removeCalendarPolicyRuleMock,
  upsertCalendarPolicyRule: upsertCalendarPolicyRuleMock,
}));

vi.mock("@/features/rules/ai/prompts/create-rule-schema", () => ({
  createRuleSchema: () => ({
    safeParse: () => ({ success: false, error: { issues: [] } }),
    extend: () => ({
      safeParse: () => ({ success: false, error: { issues: [] } }),
    }),
  }),
}));

vi.mock("@/features/rules/rule", () => ({
  createRule: vi.fn(),
  partialUpdateRule: vi.fn(),
  updateRuleActions: vi.fn(),
}));

vi.mock("@/features/rules/action-mapper", () => ({
  mapRuleActionsForMutation: vi.fn(),
}));

vi.mock("@/features/rules/learned-patterns", () => ({
  saveLearnedPatterns: vi.fn(),
}));

vi.mock("@/features/email/provider-types", () => ({
  isMicrosoftProvider: vi.fn(() => false),
}));

import { rulesTool } from "@/features/ai/tools/rules";

describe("rules tool UX behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emailAccountFindUniqueMock.mockResolvedValue({
      id: "email-1",
      account: { provider: "google" },
    });
    resumePausedEmailRulesMock.mockResolvedValue({ count: 0 });
    listEmailRulesMock.mockResolvedValue([]);
    listApprovalRuleConfigsMock.mockResolvedValue([]);
    resolveEmailRuleReferenceMock.mockResolvedValue({
      status: "none",
      matches: [],
    });
    resolveApprovalRuleReferenceMock.mockResolvedValue({
      status: "none",
      matches: [],
    });
    temporarilyDisableEmailRuleMock.mockResolvedValue({});
    disableApprovalRuleMock.mockResolvedValue({ updated: true, rule: { name: "x" } });
    listCalendarPolicyRulesMock.mockResolvedValue([]);
    resolveCalendarPolicyRuleReferenceMock.mockResolvedValue({
      status: "none",
      matches: [],
    });
    disableCalendarPolicyRuleMock.mockResolvedValue({ updated: true, rule: { id: "cr-1", title: "x" } });
    enableCalendarPolicyRuleMock.mockResolvedValue({ updated: true, rule: { id: "cr-1", title: "x" } });
    renameCalendarPolicyRuleMock.mockResolvedValue({ updated: true, rule: { id: "cr-1", title: "x" } });
    removeCalendarPolicyRuleMock.mockResolvedValue({ removed: true });
    upsertCalendarPolicyRuleMock.mockResolvedValue({ id: "cr-1", name: "Protected Friday" });
  });

  it("lists email, approval, and calendar rules by default with concise summary and hidden IDs", async () => {
    emailAccountFindUniqueMock
      .mockResolvedValueOnce({ id: "email-1", account: { provider: "google" } })
      .mockResolvedValueOnce({ about: "Exec user profile" });
    listEmailRulesMock.mockResolvedValue([
      {
        id: "er-1",
        name: "Archive newsletters",
        instructions: "archive newsletter items",
        from: null,
        to: null,
        subject: "newsletter",
        conditionalOperator: "OR",
        enabled: true,
        runOnThreads: true,
        isTemporary: false,
        expiresAt: null,
        actions: [{ type: "ARCHIVE", label: null, content: null, to: null, cc: null, bcc: null, subject: null, url: null, folderName: null }],
        group: { name: "Default" },
      },
    ]);
    listApprovalRuleConfigsMock.mockResolvedValue([
      {
        toolName: "send",
        defaultPolicy: "always",
        rules: [
          {
            id: "ar-1",
            name: "External send requires approval",
            policy: "always",
            operation: "send_email",
            enabled: true,
            priority: 100,
          },
        ],
      },
    ]);
    listCalendarPolicyRulesMock.mockResolvedValue([
      {
        id: "cr-1",
        name: "Protected travel",
        scope: "global",
        reschedulePolicy: "APPROVAL_REQUIRED",
        isProtected: true,
        notifyOnAutoMove: false,
        enabled: true,
        priority: 90,
      },
    ]);

    const result = await rulesTool.execute(
      { action: "list", payload: {} },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as never,
    );

    expect(result.success).toBe(true);
    expect(result.data.summary).toMatchObject({
      totalEmailRules: 1,
      totalApprovalRules: 1,
      totalCalendarRules: 1,
      mode: "concise",
    });
    expect(result.data.emailRules[0]).not.toHaveProperty("id");
    expect(result.data.approvalRules[0]).not.toHaveProperty("id");
    expect(result.data.calendarRules[0]).not.toHaveProperty("id");
  });

  it("sets calendar policy rules through the canonical rules tool", async () => {
    upsertCalendarPolicyRuleMock.mockResolvedValue({
      id: "cr-1",
      name: "Auto-move flexible events",
      scope: "global",
      reschedulePolicy: "FLEXIBLE",
      notifyOnAutoMove: true,
      isProtected: false,
      enabled: true,
      priority: 20,
    });

    const result = await rulesTool.execute(
      {
        action: "set_calendar_rule",
        payload: {
          name: "Auto-move flexible events",
          scope: "global",
          reschedulePolicy: "FLEXIBLE",
          notifyOnAutoMove: true,
          isProtected: false,
          priority: 20,
        },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as never,
    );

    expect(result.success).toBe(true);
    expect(upsertCalendarPolicyRuleMock).toHaveBeenCalledWith({
      userId: "user-1",
      emailAccountId: "email-1",
      rule: expect.objectContaining({
        name: "Auto-move flexible events",
        reschedulePolicy: "FLEXIBLE",
      }),
    });
  });

  it("uses a 24h default pause window for disable action", async () => {
    resolveEmailRuleReferenceMock.mockResolvedValue({
      status: "resolved",
      matches: [{ id: "er-1", name: "Archive newsletters" }],
    });

    const now = Date.now();
    const result = await rulesTool.execute(
      { action: "disable", payload: { ruleName: "Archive newsletters" } },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as never,
    );

    expect(result.success).toBe(true);
    expect(temporarilyDisableEmailRuleMock).toHaveBeenCalledTimes(1);
    const until = temporarilyDisableEmailRuleMock.mock.calls[0]?.[0]?.until as Date;
    expect(until.getTime()).toBeGreaterThan(now + 23 * 60 * 60 * 1000);
    expect(until.getTime()).toBeLessThan(now + 25 * 60 * 60 * 1000);
  });

  it("requires explicit confirm=true before deleting rules", async () => {
    const result = await rulesTool.execute(
      { action: "delete", payload: { kind: "email", ruleName: "Archive newsletters" } },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as never,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("confirm=true");
    expect(result.data).toMatchObject({ confirmationRequired: true });
    expect(ruleDeleteMock).not.toHaveBeenCalled();
    expect(removeApprovalRuleMock).not.toHaveBeenCalled();
  });

  it("resolves approval rules when kind is omitted", async () => {
    resolveEmailRuleReferenceMock.mockResolvedValue({
      status: "none",
      matches: [],
    });
    resolveApprovalRuleReferenceMock.mockResolvedValue({
      status: "resolved",
      matches: [
        {
          toolName: "send",
          rule: { id: "ar-1", name: "External send requires approval" },
        },
      ],
    });
    enableApprovalRuleMock.mockResolvedValue({
      updated: true,
      rule: { id: "ar-1", name: "External send requires approval" },
    });

    const result = await rulesTool.execute(
      { action: "enable", payload: { ruleName: "External send requires approval" } },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      } as never,
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      kind: "approval",
      toolName: "send",
    });
    expect(enableApprovalRuleMock).toHaveBeenCalledWith({
      userId: "user-1",
      toolName: "send",
      ruleId: "ar-1",
    });
  });
});
