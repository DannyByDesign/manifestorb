import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalRule } from "@/server/features/policy-plane/canonical-schema";
import { createPolicyCapabilities } from "@/server/features/ai/tools/runtime/capabilities/policy";
import {
  listRulePlaneRulesByType,
  updateRulePlaneRule,
  disableRulePlaneRule,
  removeRulePlaneRule,
} from "@/server/features/policy-plane/service";

vi.mock("@/server/features/policy-plane/service", () => ({
  compileAndActivateRulePlaneRule: vi.fn(),
  compileRulePlaneRule: vi.fn(),
  createRulePlaneRule: vi.fn(),
  disableRulePlaneRule: vi.fn(),
  listRulePlaneRulesByType: vi.fn(),
  removeRulePlaneRule: vi.fn(),
  updateRulePlaneRule: vi.fn(),
}));

function makeRule(id: string, name: string): CanonicalRule {
  return {
    id,
    version: 1,
    type: "automation",
    enabled: true,
    priority: 0,
    name,
    match: {
      resource: "email",
      conditions: [],
    },
    source: {
      mode: "ai_nl",
    },
  };
}

function buildCapabilities() {
  return createPolicyCapabilities({
    toolContext: {} as never,
    runtime: {
      userId: "user-1",
      emailAccountId: "acct-1",
      email: "user@example.com",
      provider: "google",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        with: vi.fn(),
        flush: vi.fn(),
      } as never,
    },
  });
}

describe("policy capability target selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses explicit id without model selection", async () => {
    vi.mocked(updateRulePlaneRule).mockResolvedValue({ id: "rule-1" } as never);

    const capabilities = buildCapabilities();
    const result = await capabilities.updateRule({
      id: "rule-1",
      patch: { enabled: false },
    });

    expect(result.success).toBe(true);
    expect(updateRulePlaneRule).toHaveBeenCalledWith({
      userId: "user-1",
      id: "rule-1",
      patch: { enabled: false },
    });
    expect(listRulePlaneRulesByType).not.toHaveBeenCalled();
  });

  it("resolves rule id from plain-English target and mutates", async () => {
    vi.mocked(listRulePlaneRulesByType).mockResolvedValue([
      makeRule("rule-1", "Archive newsletters"),
      makeRule("rule-2", "Disable recruiter alerts"),
    ]);
    vi.mocked(disableRulePlaneRule).mockResolvedValue({ id: "rule-2" } as never);

    const capabilities = buildCapabilities();
    const result = await capabilities.disableRule({
      target: "the recruiter alerts one",
    });

    expect(result.success).toBe(true);
    expect(disableRulePlaneRule).toHaveBeenCalledWith({
      userId: "user-1",
      id: "rule-2",
      disabledUntil: undefined,
    });
  });

  it("asks for clarification when selection is ambiguous", async () => {
    vi.mocked(listRulePlaneRulesByType).mockResolvedValue([
      makeRule("rule-1", "Archive marketing newsletters"),
      makeRule("rule-2", "Archive product newsletters"),
    ]);

    const capabilities = buildCapabilities();
    const result = await capabilities.deleteRule({
      target: "the newsletter rule",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("ambiguous_rule_target");
    expect(result.clarification?.prompt).toBe("policy_rule_target_ambiguous");
    expect(removeRulePlaneRule).not.toHaveBeenCalled();
  });

  it("asks for clarification when model cannot find a match", async () => {
    vi.mocked(listRulePlaneRulesByType).mockResolvedValue([
      makeRule("rule-1", "Archive newsletters"),
    ]);

    const capabilities = buildCapabilities();
    const result = await capabilities.updateRule({
      target: "the payroll exception rule",
      patch: { enabled: false },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("rule_not_found");
    expect(result.clarification?.prompt).toBe("policy_rule_target_not_found");
    expect(updateRulePlaneRule).not.toHaveBeenCalled();
  });
});
