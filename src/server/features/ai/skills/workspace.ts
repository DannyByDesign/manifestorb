import path from "path";
import type { RuntimeSkill } from "@/server/features/ai/skills/types";
import { loadSkillsFromRoot } from "@/server/features/ai/skills/source-loader";

export function loadWorkspaceSkills(): RuntimeSkill[] {
  const workspaceRoot = path.join(process.cwd(), "skills");
  return loadSkillsFromRoot(workspaceRoot);
}
