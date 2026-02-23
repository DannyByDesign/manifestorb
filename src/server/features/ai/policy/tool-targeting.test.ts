import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { CapabilityDefinition } from "@/server/features/ai/tools/runtime/capabilities/registry";
import {
  inferPolicyResource,
  normalizeApprovalToolName,
  normalizePolicyArgs,
} from "@/server/features/ai/policy/tool-targeting";

function definition(overrides: Partial<CapabilityDefinition>): CapabilityDefinition {
  return {
    id: "tool.test",
    description: "test",
    inputSchema: z.object({}).strict(),
    outputSchema: z.unknown(),
    readOnly: false,
    riskLevel: "caution",
    approvalOperation: "update_email",
    intentFamilies: ["inbox_mutate"],
    tags: [],
    effects: [{ resource: "email", mutates: true }],
    ...overrides,
  };
}

describe("tool-targeting", () => {
  it("maps destructive calendar operations to delete approval tool", () => {
    const mapped = normalizeApprovalToolName({
      runtimeToolName: "calendar.deleteEvent",
      definition: definition({
        id: "calendar.deleteEvent",
        approvalOperation: "delete_calendar_event",
        effects: [{ resource: "calendar", mutates: true }],
      }),
    });
    expect(mapped).toBe("delete");
  });

  it("maps update-like operations to modify approval tool", () => {
    const mapped = normalizeApprovalToolName({
      runtimeToolName: "email.batchTrash",
      definition: definition({
        id: "email.batchTrash",
        approvalOperation: "trash_email",
        effects: [{ resource: "email", mutates: true }],
      }),
    });
    expect(mapped).toBe("modify");
  });

  it("infers automation resource from operation when effect is generic", () => {
    const def = definition({
      id: "policy.updateRule",
      approvalOperation: "update_automation",
      effects: [{ resource: "rule", mutates: true }],
      intentFamilies: ["calendar_policy"],
    });
    expect(inferPolicyResource(def)).toBe("automation");
    expect(normalizePolicyArgs({ args: {}, definition: def })).toMatchObject({
      operation: "update_automation",
      resource: "automation",
    });
  });

  it("preserves explicit operation/resource overrides", () => {
    const def = definition({
      approvalOperation: "delete_email",
      effects: [{ resource: "email", mutates: true }],
    });
    const normalized = normalizePolicyArgs({
      args: { operation: "custom_operation", resource: "custom_resource" },
      definition: def,
    });
    expect(normalized).toMatchObject({
      operation: "custom_operation",
      resource: "custom_resource",
    });
  });
});
