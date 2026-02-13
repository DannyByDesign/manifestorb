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
        "I couldn't safely complete that request because it falls outside the allowed action boundary. Please ask for a direct inbox or calendar action.",
      reason: message,
    };
  }
  if (message.startsWith("capability_not_implemented")) {
    return {
      status: "failed",
      userMessage:
        "That specific action isn't supported yet in this runtime. Rephrase with a concrete inbox/calendar target and I can try the closest supported operation.",
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
        "The provider is temporarily unavailable or rate-limited. Retry in a moment, or narrow the request scope to fewer items.",
      reason: message,
    };
  }
  if (message.includes("not_found")) {
    return {
      status: "blocked",
      userMessage:
        "I couldn't find the target item. Please provide the exact thread/event reference (for example `thread_id` or `event_id`) and retry.",
      reason: message,
    };
  }
  if (message.includes("invalid_input")) {
    return {
      status: "blocked",
      userMessage:
        "I need a more specific request to run that action safely. Include who, what, and when in one sentence.",
      reason: message,
    };
  }
  return {
    status: "failed",
    userMessage:
      `${params.skill.user_response_templates.failed} Please retry with a single concrete action and explicit target.`,
    reason: message,
  };
}
