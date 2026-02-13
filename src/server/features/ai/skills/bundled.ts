import path from "path";
import type { RuntimeSkill } from "@/server/features/ai/skills/types";
import { loadSkillsFromRoot } from "@/server/features/ai/skills/source-loader";

export function loadBundledSkills(): RuntimeSkill[] {
  const bundledRoot = path.join(process.cwd(), "src/server/features/ai/skills/catalog");
  return loadSkillsFromRoot(bundledRoot);
}
