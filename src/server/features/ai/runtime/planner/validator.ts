import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";
import type {
  RuntimePlanStep,
  RuntimePlannerDraftStep,
  RuntimePlanValidationIssue,
} from "@/server/features/ai/runtime/planner/types";

function parseDraftArgs(
  argsJson: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "args_json_not_object" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, reason: "args_json_invalid" };
  }
}

function firstZodIssueMessage(error: unknown): string {
  const issues = (error as { issues?: Array<{ path?: Array<string | number>; message?: string }> })
    ?.issues;
  if (!issues || issues.length === 0) {
    return "schema_validation_failed";
  }

  const issue = issues[0]!;
  const path = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join(".") : "$";
  const message = typeof issue.message === "string" ? issue.message : "invalid";
  return `${path}:${message}`;
}

export function validateRuntimeDraftPlan(params: {
  draftSteps: RuntimePlannerDraftStep[];
  registry: RuntimeToolDefinition[];
}): {
  validSteps: RuntimePlanStep[];
  issues: RuntimePlanValidationIssue[];
} {
  const registryByCapability = new Map<string, RuntimeToolDefinition>(
    params.registry.map((definition) => [definition.capabilityId, definition]),
  );

  const validSteps: RuntimePlanStep[] = [];
  const issues: RuntimePlanValidationIssue[] = [];

  for (const [index, draft] of params.draftSteps.entries()) {
    const definition = registryByCapability.get(draft.capabilityId);
    if (!definition) {
      issues.push({
        index,
        capabilityId: draft.capabilityId,
        reason: "unknown_capability",
      });
      continue;
    }

    const parsedArgs = parseDraftArgs(draft.argsJson);
    if (!parsedArgs.ok) {
      issues.push({
        index,
        capabilityId: draft.capabilityId,
        reason: parsedArgs.reason,
      });
      continue;
    }

    const validation = definition.parameters.safeParse(parsedArgs.value);
    if (!validation.success) {
      issues.push({
        index,
        capabilityId: draft.capabilityId,
        reason: firstZodIssueMessage(validation.error),
      });
      continue;
    }

    validSteps.push({
      capabilityId: definition.capabilityId,
      args: parsedArgs.value,
      rationale: draft.rationale,
    });
  }

  return {
    validSteps,
    issues,
  };
}
