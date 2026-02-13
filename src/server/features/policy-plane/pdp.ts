import {
  evaluateApprovalRequirement,
  type ApprovalEvaluation,
} from "@/server/features/approvals/rules";

export type PolicyDecisionKind =
  | "allow"
  | "block"
  | "require_approval"
  | "allow_with_transform";

export type PolicyDecision = {
  kind: PolicyDecisionKind;
  reasonCode: string;
  message: string;
  approval?: ApprovalEvaluation;
  transformedArgs?: Record<string, unknown>;
};

export type PolicyIntent = {
  userId: string;
  toolName: string;
  args: Record<string, unknown>;
  context: {
    source:
      | "skills"
      | "planner"
      | "automation"
      | "scheduled"
      | "calendar_replanner"
      | "task_scheduler";
  };
};

/**
 * Unified policy decision point (PDP).
 * Current implementation uses the approval rules engine as the first canonical
 * decision source; later phases add block/transform canonical rule evaluation.
 */
export async function evaluatePolicyDecision(
  intent: PolicyIntent,
): Promise<PolicyDecision> {
  const approval = await evaluateApprovalRequirement({
    userId: intent.userId,
    toolName: intent.toolName,
    args: intent.args,
  });

  if (approval.requiresApproval) {
    return {
      kind: "require_approval",
      reasonCode: "approval_required",
      message: "Action requires approval before execution.",
      approval,
    };
  }

  return {
    kind: "allow",
    reasonCode: "allowed",
    message: "Action allowed by current policy.",
    approval,
  };
}
