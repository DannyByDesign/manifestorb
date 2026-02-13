import type { RuntimeSkill, RuntimeSkillSnapshot } from "@/server/features/ai/skills/types";

const MAX_SKILLS = 4;
const MAX_SECTION_CHARS = 9000;

function scoreSkill(message: string, skill: RuntimeSkill): number {
  const m = message.toLowerCase();
  let score = 0;

  for (const tag of skill.tags) {
    if (tag && m.includes(tag)) score += 2;
  }

  if (skill.id.includes("inbox") || skill.id.includes("email")) {
    if (m.includes("inbox") || m.includes("email") || m.includes("thread")) score += 3;
  }

  if (skill.id.includes("calendar")) {
    if (m.includes("calendar") || m.includes("meeting") || m.includes("schedule")) score += 3;
  }

  if (skill.id.includes("rule") || skill.id.includes("policy")) {
    if (m.includes("rule") || m.includes("approval") || m.includes("preference")) score += 3;
  }

  return score;
}

export function buildSkillPromptSnapshot(params: {
  message: string;
  skills: RuntimeSkill[];
}): RuntimeSkillSnapshot {
  const scored = params.skills
    .map((skill) => ({ skill, score: scoreSkill(params.message, skill) }))
    .sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, MAX_SKILLS).map((item) => item.skill);

  const sections: string[] = [];
  let usedChars = 0;
  for (const skill of selected) {
    const block = `### Skill: ${skill.title}\n${skill.body}\n`;
    if (usedChars + block.length > MAX_SECTION_CHARS) break;
    sections.push(block);
    usedChars += block.length;
  }

  return {
    selectedSkillIds: selected.map((skill) => skill.id),
    promptSection: sections.join("\n").trim(),
  };
}
