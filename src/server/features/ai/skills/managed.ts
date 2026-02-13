import path from "path";
import type { RuntimeSkill } from "@/server/features/ai/skills/types";
import { loadSkillsFromRoot } from "@/server/features/ai/skills/source-loader";

export function loadManagedSkills(): RuntimeSkill[] {
  const managedRoot = path.join(process.cwd(), "src/server/features/ai/skills/managed");
  return loadSkillsFromRoot(managedRoot);
}
