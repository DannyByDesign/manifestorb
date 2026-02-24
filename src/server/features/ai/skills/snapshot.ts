import type { RuntimeSkill, RuntimeSkillSnapshot } from "@/server/features/ai/skills/types";
import { formatSkillPromptSection } from "@/server/features/ai/skills/prompt";
import type { RuntimeTurnContract } from "@/server/features/ai/runtime/turn-contract";

const MAX_SKILLS = 4;

function selectById(skills: RuntimeSkill[], predicate: (id: string) => boolean): RuntimeSkill[] {
  return skills.filter((skill) => predicate(skill.id.toLowerCase()));
}

export function buildSkillPromptSnapshot(params: {
  turn: RuntimeTurnContract;
  skills: RuntimeSkill[];
}): RuntimeSkillSnapshot {
  const selected = new Map<string, RuntimeSkill>();
  const add = (skills: RuntimeSkill[]) => {
    for (const skill of skills) {
      if (selected.size >= MAX_SKILLS) break;
      selected.set(skill.id, skill);
    }
  };

  // Always include the main secretary skill when available.
  add(selectById(params.skills, (id) => id.includes("inbox-calendar-agent")));

  if (params.turn.domain === "inbox") {
    add(selectById(params.skills, (id) => id.includes("inbox") || id.includes("email")));
  }
  if (params.turn.domain === "calendar") {
    add(selectById(params.skills, (id) => id.includes("calendar") || id.includes("task")));
  }
  if (params.turn.requestedOperation === "mutate" || params.turn.riskLevel !== "low") {
    add(selectById(params.skills, (id) => id.includes("rule") || id.includes("policy")));
  }

  if (selected.size < MAX_SKILLS) {
    add([...params.skills].sort((a, b) => a.id.localeCompare(b.id)));
  }

  const ordered = Array.from(selected.values()).slice(0, MAX_SKILLS);

  return {
    selectedSkillIds: ordered.map((skill) => skill.id),
    promptSection: formatSkillPromptSection(ordered),
  };
}
