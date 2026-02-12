import { parseSkillContract, type SkillContract } from "@/server/features/ai/skills/contracts/skill-contract";
import { baselineSkills } from "@/server/features/ai/skills/baseline";
import type { SkillId } from "@/server/features/ai/skills/baseline/skill-ids";

const entries = baselineSkills.map((skill) => {
  const parsed = parseSkillContract(skill);
  return [parsed.id, parsed] as const;
});

const duplicateCheck = new Set<string>();
for (const [id] of entries) {
  if (duplicateCheck.has(id)) {
    throw new Error(`Duplicate baseline skill id: ${id}`);
  }
  duplicateCheck.add(id);
}

export const baselineSkillRegistry: ReadonlyMap<SkillId, SkillContract> = new Map(entries as Array<[SkillId, SkillContract]>);

export function getBaselineSkill(skillId: SkillId): SkillContract {
  const skill = baselineSkillRegistry.get(skillId);
  if (!skill) {
    throw new Error(`Baseline skill not found: ${skillId}`);
  }
  return skill;
}

export function listBaselineSkills(): SkillContract[] {
  return Array.from(baselineSkillRegistry.values());
}
