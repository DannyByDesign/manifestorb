import { evaluateApprovalRequirement, type ApprovalPolicy } from "@/features/approvals/rules";

/**
 * Check whether a tool call requires approval for a given user.
 * Returns true if approval is required.
 */
export async function requiresApproval({
  userId,
  toolName,
  args,
}: {
  userId: string;
  toolName: string;
  args?: Record<string, unknown>;
}): Promise<boolean> {
  const decision = await evaluateApprovalRequirement({
    userId,
    toolName,
    args,
  });
  return decision.requiresApproval;
}

export type { ApprovalPolicy };
