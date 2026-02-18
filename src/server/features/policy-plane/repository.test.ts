import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  disableCanonicalRule,
  listEffectiveCanonicalRules,
} from "@/server/features/policy-plane/repository";

vi.mock("server-only", () => ({}));

const prismaMock = vi.hoisted(() => ({
  canonicalRule: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  canonicalRuleVersion: {
    create: vi.fn(),
  },
}));

vi.mock("@/server/db/client", () => ({
  default: prismaMock,
}));

vi.mock("@/server/features/search/index/ingestors/rule", () => ({
  enqueueRuleDocumentForIndexing: vi.fn(),
  enqueueRuleDeleteForIndexing: vi.fn(),
}));

vi.mock("@/server/features/search/index/repository", () => ({
  upsertSearchIngestionCheckpoint: vi.fn().mockResolvedValue(undefined),
}));

describe("policy-plane/repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function canonicalRuleRow(overrides: Partial<Record<string, unknown>> = {}) {
    const now = new Date("2026-02-18T00:00:00.000Z");
    return {
      id: "rule-id",
      createdAt: now,
      updatedAt: now,
      version: 1,
      type: "guardrail",
      enabled: true,
      priority: 0,
      name: "Rule",
      description: "Desc",
      scope: null,
      match: { resource: "email", conditions: [] },
      trigger: null,
      decision: null,
      transform: null,
      actionPlan: null,
      preferencePatch: null,
      expiresAt: null,
      disabledUntil: null,
      sourceMode: "system",
      sourceNl: null,
      sourceMessageId: null,
      sourceConversationId: null,
      compilerVersion: null,
      compilerConfidence: null,
      compilerWarnings: null,
      legacyRefType: null,
      legacyRefId: null,
      userId: "user-id",
      emailAccountId: null,
      ...overrides,
    };
  }

  it("orders account-specific rules before global rules when priority ties", async () => {
    vi.mocked(prismaMock.canonicalRule.findMany).mockResolvedValue([
      canonicalRuleRow({
        id: "global",
        priority: 10,
        emailAccountId: null,
        updatedAt: new Date("2026-02-18T00:00:10.000Z"),
      }),
      canonicalRuleRow({
        id: "scoped",
        priority: 10,
        emailAccountId: "acct-1",
        updatedAt: new Date("2026-02-18T00:00:00.000Z"),
      }),
      canonicalRuleRow({
        id: "low",
        priority: 5,
        emailAccountId: "acct-1",
        updatedAt: new Date("2026-02-18T00:00:20.000Z"),
      }),
    ] as never);

    const rules = await listEffectiveCanonicalRules({
      userId: "user-id",
      emailAccountId: "acct-1",
    });

    expect(rules.map((r) => r.id)).toEqual(["scoped", "global", "low"]);
  });

  it("disableCanonicalRule disables permanently when disabledUntil is missing", async () => {
    vi.mocked(prismaMock.canonicalRule.findFirst).mockResolvedValue(
      canonicalRuleRow({ id: "r1", version: 3 }) as never,
    );
    vi.mocked(prismaMock.canonicalRule.update).mockResolvedValue(
      canonicalRuleRow({ id: "r1", version: 4, enabled: false, disabledUntil: null }) as never,
    );

    await disableCanonicalRule({ userId: "user-id", id: "r1" });

    expect(prismaMock.canonicalRule.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: expect.objectContaining({
        version: 4,
        enabled: false,
        disabledUntil: null,
      }),
    });
    expect(prismaMock.canonicalRuleVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        canonicalRuleId: "r1",
        version: 4,
      }),
    });
  });

  it("disableCanonicalRule supports temporary disable via disabledUntil while keeping enabled=true", async () => {
    vi.mocked(prismaMock.canonicalRule.findFirst).mockResolvedValue(
      canonicalRuleRow({ id: "r2", version: 1 }) as never,
    );
    vi.mocked(prismaMock.canonicalRule.update).mockResolvedValue(
      canonicalRuleRow({
        id: "r2",
        version: 2,
        enabled: true,
        disabledUntil: new Date("2026-03-01T00:00:00.000Z"),
      }) as never,
    );

    await disableCanonicalRule({
      userId: "user-id",
      id: "r2",
      disabledUntil: "2026-03-01T00:00:00.000Z",
    });

    expect(prismaMock.canonicalRule.update).toHaveBeenCalledWith({
      where: { id: "r2" },
      data: expect.objectContaining({
        version: 2,
        enabled: true,
        disabledUntil: new Date("2026-03-01T00:00:00.000Z"),
      }),
    });
    expect(prismaMock.canonicalRuleVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        canonicalRuleId: "r2",
        version: 2,
      }),
    });
  });
});
