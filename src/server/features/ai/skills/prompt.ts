import type { RuntimeSkill } from "@/server/features/ai/skills/types";

const MAX_SECTION_CHARS = 9000;

export function formatSkillPromptSection(skills: RuntimeSkill[]): string {
  const sections: string[] = [];
  let usedChars = 0;

  for (const skill of skills) {
    const block = `### Skill: ${skill.title}\n${skill.body}\n`;
    if (usedChars + block.length > MAX_SECTION_CHARS) break;
    sections.push(block);
    usedChars += block.length;
  }

  return sections.join("\n").trim();
}
