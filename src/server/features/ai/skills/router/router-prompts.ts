import type { SkillContract } from "@/server/features/ai/skills/contracts/skill-contract";

export function buildBaselineSkillMenu(skills: readonly SkillContract[]): string {
  return skills
    .map((skill) => {
      const examples = skill.intent_examples
        .slice(0, 4)
        .map((e) => `- ${e}`)
        .join("\n");
      return `Skill: ${skill.id}\nExamples:\n${examples}`;
    })
    .join("\n\n");
}

export function buildBaselineRouterPrompt(params: {
  message: string;
  skillMenu: string;
}): string {
  return `You are a strict router for an inbox/calendar assistant.
Pick the single best baseline skill for the user's message, or return null if unclear.

Rules:
- You MUST choose from the provided skill IDs only.
- If multiple skills could apply, choose the one that best matches the user's primary goal.
- If the message lacks required details to safely pick a skill, set skillId=null and write a single targeted clarificationPrompt.
- confidence:
  - 0.90-1.00 only if unambiguous
  - 0.70-0.89 if likely but could be wrong
  - <0.70 if unclear (prefer null)

User message:
${params.message.trim()}

Baseline skills:
${params.skillMenu}
`;
}

