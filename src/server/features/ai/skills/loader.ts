import type { RuntimeSkill } from "@/server/features/ai/skills/types";
import { composeSkills } from "@/server/features/ai/skills/composition";
import { loadWorkspaceSkills } from "@/server/features/ai/skills/workspace";
import { loadManagedSkills } from "@/server/features/ai/skills/managed";
import { loadBundledSkills } from "@/server/features/ai/skills/bundled";

export function loadRuntimeSkills(): RuntimeSkill[] {
  const composition = composeSkills({
    workspace: loadWorkspaceSkills(),
    managed: loadManagedSkills(),
    bundled: loadBundledSkills(),
  });
  return composition.skills;
}
