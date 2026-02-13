import type { SkillContract } from "@/server/features/ai/skills/contracts/skill-contract";

export function normalizeSkillFailure(params: {
  skill: SkillContract;
  errorMessage: string;
}): { status: "failed" | "blocked"; userMessage: string; reason: string } {
  const message = params.errorMessage.toLowerCase();
  if (message.startsWith("allowed_tools_violation")) {
    return {
      status: "blocked",
      userMessage:
        "I couldn't safely complete that request because it falls outside the allowed action boundary.",
      reason: message,
    };
  }
  if (message.startsWith("capability_not_implemented")) {
    return {
      status: "failed",
      userMessage:
        "That action isn't supported yet in this runtime. Try a related inbox/calendar action.",
      reason: message,
    };
  }
  if (
    message.includes("rate_limit") ||
    message.includes("timeout") ||
    message.includes("temporar")
  ) {
    return {
      status: "failed",
      userMessage:
        "The provider is temporarily unavailable or rate-limited. Please retry in a moment.",
      reason: message,
    };
  }
  if (message.includes("not_found")) {
    return {
      status: "blocked",
      userMessage:
        "I couldn't find the target item. Please reference the exact thread/event and try again.",
      reason: message,
    };
  }
  if (message.includes("invalid_input")) {
    return {
      status: "blocked",
      userMessage: "I need a more specific request to run that action safely.",
      reason: message,
    };
  }
  return { status: "failed", userMessage: params.skill.user_response_templates.failed, reason: message };
}
