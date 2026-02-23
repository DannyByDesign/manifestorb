import type { CapabilityDefinition } from "@/server/features/ai/tools/runtime/capabilities/registry";

export const APPROVAL_TOOL_NAMES = [
  "query",
  "get",
  "analyze",
  "send",
  "create",
  "modify",
  "delete",
  "rules",
  "triage",
  "workflow",
] as const;

export type ApprovalToolName = (typeof APPROVAL_TOOL_NAMES)[number];

export function isApprovalToolName(value: string | undefined): value is ApprovalToolName {
  if (!value) return false;
  return (APPROVAL_TOOL_NAMES as readonly string[]).includes(value);
}

function inferResourceFromApprovalOperation(operation: string): string | undefined {
  const normalized = operation.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes("email")) return "email";
  if (normalized.includes("calendar")) return "calendar";
  if (normalized.includes("task")) return "task";
  if (normalized.includes("automation")) return "automation";
  if (normalized.includes("knowledge")) return "knowledge";
  if (normalized.includes("approval")) return "approval";
  if (normalized.includes("rule")) return "rule";
  if (normalized.includes("preference")) return "preferences";
  return undefined;
}

export function inferPolicyResource(definition: CapabilityDefinition): string {
  const fromOperation = inferResourceFromApprovalOperation(definition.approvalOperation);
  if (fromOperation) return fromOperation;

  const mutatingEffect = definition.effects.find((effect) => effect.mutates);
  if (mutatingEffect) return mutatingEffect.resource;
  const first = definition.effects[0];
  return first ? first.resource : "workflow";
}

export function normalizeApprovalToolName(params: {
  runtimeToolName: string;
  definition: CapabilityDefinition;
}): ApprovalToolName {
  const operation = params.definition.approvalOperation.trim().toLowerCase();
  if (params.runtimeToolName.startsWith("policy.")) return "rules";
  if (params.runtimeToolName.startsWith("planner.")) return "workflow";

  if (operation === "query") return "query";
  if (operation === "get") return "get";
  if (operation === "analyze") return "analyze";
  if (operation === "send_email" || operation === "draft_and_send") return "send";
  if (operation === "run_workflow") return "workflow";
  if (operation === "triage_tasks") return "triage";
  if (operation === "create_rule" || operation === "update_rule" || operation === "delete_rule") {
    return "rules";
  }
  if (operation.startsWith("delete_")) return "delete";
  if (operation.startsWith("create_")) return "create";

  if (!params.definition.readOnly && params.definition.effects.some((effect) => effect.mutates)) {
    return "modify";
  }

  return "query";
}

export function normalizePolicyArgs(params: {
  args: Record<string, unknown>;
  definition: CapabilityDefinition;
}): Record<string, unknown> {
  const normalized = { ...params.args };
  if (typeof normalized.operation !== "string" || normalized.operation.trim().length === 0) {
    normalized.operation = params.definition.approvalOperation;
  }
  if (typeof normalized.resource !== "string" || normalized.resource.trim().length === 0) {
    normalized.resource = inferPolicyResource(params.definition);
  }
  if (!("itemCount" in normalized) && Array.isArray(normalized.ids)) {
    normalized.itemCount = normalized.ids.length;
  }
  return normalized;
}
