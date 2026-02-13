import { validateCapabilityArgs } from "@/server/features/ai/capabilities/validator";
import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import type { PlannerPlan, PlannerStep, PlannerValidationIssue } from "@/server/features/ai/planner/types";

export interface PlannerValidationResult {
  ok: boolean;
  issues: PlannerValidationIssue[];
  normalizedPlan?: PlannerPlan;
}

function hasCycle(steps: PlannerStep[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const step of steps) {
    adjacency.set(step.id, step.dependsOn ?? []);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(node: string): boolean {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    const deps = adjacency.get(node) ?? [];
    for (const dep of deps) {
      if (dfs(dep)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  for (const key of adjacency.keys()) {
    if (dfs(key)) return true;
  }
  return false;
}

function collectTemplateReferences(
  value: unknown,
  refs: string[] = [],
): string[] {
  if (typeof value === "string") {
    const match = value.match(/^\{\{\s*([a-zA-Z0-9_-]+)(?:\.[a-zA-Z0-9_.-]+)?\s*\}\}$/u);
    if (match?.[1]) refs.push(match[1]);
    return refs;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTemplateReferences(item, refs);
    }
    return refs;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectTemplateReferences(item, refs);
    }
  }
  return refs;
}

export function validatePlannerPlan(params: {
  plan: PlannerPlan;
  allowedCapabilities: CapabilityName[];
}): PlannerValidationResult {
  const issues: PlannerValidationIssue[] = [];
  const allowed = new Set(params.allowedCapabilities);
  const stepById = new Map<string, PlannerStep>();

  for (const step of params.plan.steps) {
    if (stepById.has(step.id)) {
      issues.push({
        code: "duplicate_step_id",
        message: `Duplicate step id: ${step.id}`,
        stepId: step.id,
      });
      continue;
    }
    stepById.set(step.id, step);

    if (!allowed.has(step.capability)) {
      issues.push({
        code: "capability_not_allowed",
        message: `Step uses capability outside candidate set: ${step.capability}`,
        stepId: step.id,
      });
    }
  }

  for (const step of params.plan.steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!stepById.has(dep)) {
        issues.push({
          code: "unknown_dependency",
          message: `Step ${step.id} references unknown dependency: ${dep}`,
          stepId: step.id,
        });
      }
    }

    const templateRefs = collectTemplateReferences(step.args);
    for (const ref of templateRefs) {
      if (!stepById.has(ref)) {
        issues.push({
          code: "unresolved_template_reference",
          message: `Step ${step.id} references unknown template step: ${ref}`,
          stepId: step.id,
        });
        continue;
      }
      if (!(step.dependsOn ?? []).includes(ref)) {
        issues.push({
          code: "missing_template_dependency",
          message: `Step ${step.id} uses template output from ${ref} but does not declare dependsOn.`,
          stepId: step.id,
        });
      }
    }
  }

  if (hasCycle(params.plan.steps)) {
    issues.push({
      code: "cyclic_dependencies",
      message: "Plan graph contains dependency cycle.",
    });
  }

  const normalizedSteps: PlannerStep[] = [];
  for (const step of params.plan.steps) {
    const validated = validateCapabilityArgs({
      capability: step.capability,
      args: step.args,
    });
    if (!validated.ok) {
      issues.push({
        code: validated.errorCode,
        message: `Step ${step.id} arg validation failed: ${validated.message}`,
        stepId: step.id,
      });
      continue;
    }

    normalizedSteps.push({
      ...step,
      args: validated.normalizedArgs,
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    issues: [],
    normalizedPlan: {
      goal: params.plan.goal,
      steps: normalizedSteps,
    },
  };
}
