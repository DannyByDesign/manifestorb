import type { OpenWorldTurnInput } from "@/server/features/ai/runtime/types";

export interface RuntimeContextRequirementIssue {
  key: string;
  message: string;
}

export function evaluateRuntimeContextRequirements(
  input: OpenWorldTurnInput,
): RuntimeContextRequirementIssue[] {
  const issues: RuntimeContextRequirementIssue[] = [];

  if (!input.userId) {
    issues.push({ key: "userId", message: "Missing user context." });
  }
  if (!input.emailAccountId) {
    issues.push({ key: "emailAccountId", message: "Missing email account context." });
  }
  if (!input.email) {
    issues.push({ key: "email", message: "Missing account email context." });
  }
  if (!input.message || input.message.trim().length === 0) {
    issues.push({ key: "message", message: "Missing user message content." });
  }

  return issues;
}
