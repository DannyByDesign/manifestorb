import type { RuntimeSkill } from "@/server/features/ai/skills/types";

export interface SkillCompositionSnapshot {
  skills: RuntimeSkill[];
  sources: {
    workspace: number;
    managed: number;
    bundled: number;
  };
}

export function composeSkills(params: {
  workspace: RuntimeSkill[];
  managed: RuntimeSkill[];
  bundled: RuntimeSkill[];
}): SkillCompositionSnapshot {
  const byId = new Map<string, RuntimeSkill>();

  // precedence: workspace > managed > bundled
  for (const skill of params.bundled) {
    byId.set(skill.id, skill);
  }
  for (const skill of params.managed) {
    byId.set(skill.id, skill);
  }
  for (const skill of params.workspace) {
    byId.set(skill.id, skill);
  }

  return {
    skills: [...byId.values()],
    sources: {
      workspace: params.workspace.length,
      managed: params.managed.length,
      bundled: params.bundled.length,
    },
  };
}
