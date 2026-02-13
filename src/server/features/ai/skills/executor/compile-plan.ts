import type { SkillContract } from "@/server/features/ai/skills/contracts/skill-contract";
import type { SlotResolutionResult } from "@/server/features/ai/skills/slots/resolve-slots";
import type { CompiledPlan, PlanNode } from "@/server/features/ai/skills/executor/plan-ir";
import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";

function shouldSkipStep(params: {
  skill: SkillContract;
  slotResolution: SlotResolutionResult;
  capability?: string;
}): string | null {
  if (!params.capability) return null;

  if (params.skill.id === "calendar_working_hours_ooo") {
    const policy = String(params.slotResolution.resolved.policy_type ?? "");
    if (policy === "working_hours" && params.capability === "calendar.setOutOfOffice") {
      return "policy_type=working_hours";
    }
    if (policy === "out_of_office" && params.capability === "calendar.setWorkingHours") {
      return "policy_type=out_of_office";
    }
  }

  return null;
}

export function compileSkillPlan(params: {
  skill: SkillContract;
  slotResolution: SlotResolutionResult;
}): CompiledPlan {
  const nodes: PlanNode[] = [];

  for (const step of params.skill.plan) {
    const skipReason = shouldSkipStep({
      skill: params.skill,
      slotResolution: params.slotResolution,
      capability: step.capability,
    });

    if (skipReason) {
      nodes.push({
        id: `${step.id}_skip`,
        type: "conditional_skip",
        description: `Skip ${step.id}`,
        reason: skipReason,
      });
      continue;
    }

    if (step.capability) {
      if (isMutatingCapability(step.capability)) {
        nodes.push({
          id: `policy_precheck_${step.id}`,
          type: "policy_precheck",
          description: `Evaluate policy constraints before ${step.id}`,
          capability: step.capability,
        });
      }
      nodes.push({
        id: step.id,
        type: "capability_call",
        description: step.description,
        capability: step.capability,
        requiredSlots: step.requiredSlots ?? [],
      });
    }
  }

  for (const check of params.skill.success_checks) {
    nodes.push({
      id: `post_${check.id}`,
      type: "postcondition_check",
      description: check.description,
      checkId: check.id,
    });
  }

  return { nodes };
}

function isMutatingCapability(capability: CapabilityName): boolean {
  if (capability.startsWith("email.search")) return false;
  if (capability === "email.getThreadMessages") return false;
  if (capability === "email.getMessagesBatch") return false;
  if (capability === "email.getLatestMessage") return false;
  if (capability === "email.listFilters") return false;
  if (capability === "email.listDrafts") return false;
  if (capability === "email.getDraft") return false;
  if (capability === "calendar.findAvailability") return false;
  if (capability === "calendar.listEvents") return false;
  if (capability === "calendar.searchEventsByAttendee") return false;
  if (capability === "calendar.getEvent") return false;
  if (capability === "planner.composeDayPlan") return false;
  if (capability === "planner.compileMultiActionPlan") return false;
  if (capability === "policy.listRules") return false;
  if (capability === "policy.compileRule") return false;
  return true;
}
