import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findFirstMock,
  findManyMock,
  upsertMock,
  deleteManyMock,
  transactionMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  upsertMock: vi.fn(),
  deleteManyMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  default: {
    canonicalRule: {
      findFirst: findFirstMock,
      findMany: findManyMock,
      update: upsertMock,
      create: upsertMock,
      deleteMany: deleteManyMock,
    },
    $transaction: transactionMock,
  },
}));

import {
  deriveApprovalTarget,
  evaluateApprovalRequirement,
  getApprovalOperationLabel,
  listApprovalRuleConfigs,
  normalizeApprovalOperationKey,
  resolveApprovalRuleReference,
  removeApprovalRule,
  setApprovalToolDefaultPolicy,
  upsertApprovalRule,
} from "@/features/approvals/rules";
import { listToolDefinitions } from "@/server/features/ai/tools/runtime/capabilities/registry";
import {
  normalizeApprovalToolName,
  normalizePolicyArgs,
} from "@/server/features/ai/policy/tool-targeting";

describe("approval rules engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(null);
    findManyMock.mockResolvedValue([]);
    upsertMock.mockResolvedValue({});
    deleteManyMock.mockResolvedValue({ count: 0 });
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        canonicalRule: {
          findFirst: findFirstMock,
          update: upsertMock,
          create: upsertMock,
        },
      }),
    );
  });

  it("derives operation and recipients for send calls", () => {
    const target = deriveApprovalTarget("send", {
      draftId: "d1",
      data: { to: ["CEO <ceo@outside.com>"] },
    });
    expect(target.operation).toBe("send_email");
    expect(target.recipientEmails).toEqual(["ceo@outside.com"]);
  });

  it("requires approval by default for send", async () => {
    await expect(
      evaluateApprovalRequirement({ userId: "u1", toolName: "send", args: {} }),
    ).resolves.toMatchObject({ requiresApproval: true, source: "default" });
  });

  it("requires approval by default for destructive email modify", async () => {
    await expect(
      evaluateApprovalRequirement({
        userId: "u1",
        toolName: "modify",
        args: { resource: "email", ids: ["m1"], changes: { trash: true } },
      }),
    ).resolves.toMatchObject({ requiresApproval: true, source: "rule" });
  });

  it("keeps email.batchTrash mapping in parity with default always-approval trash rule", async () => {
    const definition = listToolDefinitions().find(
      (entry) => entry.id === "email.batchTrash",
    );
    expect(definition).toBeDefined();
    expect(definition?.approvalOperation).toBe("trash_email");

    const toolName = normalizeApprovalToolName({
      runtimeToolName: definition!.id,
      definition: definition!,
    });
    const normalizedArgs = normalizePolicyArgs({
      args: { ids: ["msg-1"] },
      definition: definition!,
    });
    const decision = await evaluateApprovalRequirement({
      userId: "u1",
      toolName,
      args: normalizedArgs,
    });

    expect(toolName).toBe("modify");
    expect(decision.target.operation).toBe("trash_email");
    expect(decision.requiresApproval).toBe(true);
  });

  it("keeps email.restore mapping in parity with restore approval rule", async () => {
    const definition = listToolDefinitions().find(
      (entry) => entry.id === "email.restore",
    );
    expect(definition).toBeDefined();
    expect(definition?.approvalOperation).toBe("restore_email");

    const toolName = normalizeApprovalToolName({
      runtimeToolName: definition!.id,
      definition: definition!,
    });
    const normalizedArgs = normalizePolicyArgs({
      args: { ids: ["msg-1"] },
      definition: definition!,
    });
    const decision = await evaluateApprovalRequirement({
      userId: "u1",
      toolName,
      args: normalizedArgs,
    });

    expect(toolName).toBe("modify");
    expect(decision.target.operation).toBe("restore_email");
    expect(decision.requiresApproval).toBe(true);
  });

  it("requires approval only for bulk email delete by default", async () => {
    await expect(
      evaluateApprovalRequirement({
        userId: "u1",
        toolName: "delete",
        args: { resource: "email", ids: ["m1"] },
      }),
    ).resolves.toMatchObject({ requiresApproval: false });

    await expect(
      evaluateApprovalRequirement({
        userId: "u1",
        toolName: "delete",
        args: {
          resource: "email",
          ids: Array.from({ length: 30 }, (_, i) => `m${i}`),
        },
      }),
    ).resolves.toMatchObject({ requiresApproval: true });
  });

  it("never requires approval for approval decisions", async () => {
    await expect(
      evaluateApprovalRequirement({
        userId: "u1",
        toolName: "modify",
        args: {
          resource: "approval",
          ids: ["approval-1"],
          changes: { decision: "APPROVE" },
        },
      }),
    ).resolves.toMatchObject({ requiresApproval: false });
  });

  it("supports legacy conditional external-only preferences", async () => {
    findFirstMock.mockResolvedValue({
      decision: "conditional",
      preferencePatch: { externalOnly: true, domains: ["example.com"] },
    });

    await expect(
      evaluateApprovalRequirement({
        userId: "u1",
        toolName: "send",
        args: { data: { to: ["inside@example.com"] } },
      }),
    ).resolves.toMatchObject({ requiresApproval: false });

    await expect(
      evaluateApprovalRequirement({
        userId: "u1",
        toolName: "send",
        args: { data: { to: ["outside@other.com"] } },
      }),
    ).resolves.toMatchObject({ requiresApproval: true });
  });

  it("supports v2 scoped rules persisted in conditions", async () => {
    findFirstMock.mockResolvedValue({
      decision: "never",
      preferencePatch: {
        version: 2,
        defaultPolicy: "never",
        rules: [
          {
            id: "rule-send-external",
            name: "External sends require approval",
            policy: "always",
            operation: "send_email",
            conditions: { externalOnly: true, domains: ["example.com"] },
          },
        ],
      },
    });

    await expect(
      evaluateApprovalRequirement({
        userId: "u1",
        toolName: "send",
        args: { data: { to: ["inside@example.com"] } },
      }),
    ).resolves.toMatchObject({ requiresApproval: false, source: "default" });

    await expect(
      evaluateApprovalRequirement({
        userId: "u1",
        toolName: "send",
        args: { data: { to: ["outside@other.com"] } },
      }),
    ).resolves.toMatchObject({
      requiresApproval: true,
      source: "rule",
      matchedRule: { id: "rule-send-external" },
    });
  });

  it("allows approval rules to be listed and mutated", async () => {
    findManyMock.mockResolvedValue([
      {
        name: "approval:send",
        decision: "always",
        preferencePatch: {
          version: 2,
          defaultPolicy: "always",
          rules: [],
        },
      },
    ]);
    const listed = await listApprovalRuleConfigs({ userId: "u1" });
    expect(listed.find((entry) => entry.toolName === "send")?.defaultPolicy).toBe(
      "always",
    );

    await upsertApprovalRule({
      userId: "u1",
      toolName: "send",
      rule: {
        name: "Always approve external",
        policy: "always",
        operation: "send_email",
        conditions: { externalOnly: true, domains: ["example.com"] },
      },
    });
    expect(upsertMock).toHaveBeenCalledOnce();

    await setApprovalToolDefaultPolicy({
      userId: "u1",
      toolName: "send",
      defaultPolicy: "never",
    });
    expect(upsertMock).toHaveBeenCalledTimes(2);

    findFirstMock.mockResolvedValue({
      decision: "never",
      preferencePatch: {
        version: 2,
        defaultPolicy: "never",
        rules: [{ id: "r1", name: "x", policy: "always" }],
      },
    });
    await removeApprovalRule({ userId: "u1", toolName: "send", ruleId: "r1" });
    expect(upsertMock).toHaveBeenCalledTimes(3);
  });

  it("normalizes plain-English operation labels to machine keys", () => {
    expect(normalizeApprovalOperationKey("Send email")).toBe("send_email");
    expect(getApprovalOperationLabel("delete_calendar_event")).toBe(
      "Delete calendar events",
    );
  });

  it("resolves approval rules by fuzzy name and respects toolName scoping", async () => {
    findManyMock.mockResolvedValue([
      {
        name: "approval:send",
        decision: "always",
        preferencePatch: {
          version: 2,
          defaultPolicy: "always",
          rules: [{ id: "a1", name: "External send guard", policy: "always" }],
        },
      },
      {
        name: "approval:delete",
        decision: "never",
        preferencePatch: {
          version: 2,
          defaultPolicy: "never",
          rules: [{ id: "a2", name: "Delete guard", policy: "always" }],
        },
      },
    ]);
    const resolved = await resolveApprovalRuleReference({
      userId: "u1",
      reference: { name: "external send", toolName: "send" },
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.matches[0]?.rule.id).toBe("a1");
  });
});
