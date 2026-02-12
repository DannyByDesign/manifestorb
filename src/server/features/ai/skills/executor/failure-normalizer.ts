import type { SkillContract } from "@/server/features/ai/skills/contracts/skill-contract";

export function normalizeSkillFailure(params: {
  skill: SkillContract;
  errorMessage: string;
}): { status: "failed" | "blocked"; userMessage: string; reason: string } {
  const message = params.errorMessage;
  if (message.startsWith("allowed_tools_violation")) {
    return { status: "blocked", userMessage: "I couldn't safely complete that request.", reason: message };
  }
  if (message.startsWith("capability_not_implemented")) {
    return { status: "failed", userMessage: "That action isn't available yet.", reason: message };
  }
  return { status: "failed", userMessage: params.skill.user_response_templates.failed, reason: message };
}

