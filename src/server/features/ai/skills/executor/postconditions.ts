import type { SkillContract } from "@/server/features/ai/skills/contracts/skill-contract";
import type { ToolResult } from "@/server/features/ai/tools/types";

// Phase 1: fail-closed postconditions.
// We only mark postconditions passed if all tool steps reported success.
export function validateSkillPostconditions(params: {
  skill: SkillContract;
  toolResults: Record<string, ToolResult>;
}): boolean {
  void params.skill;
  return Object.values(params.toolResults).every((r) => r.success === true);
}

