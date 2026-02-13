import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import type { ApprovalEvaluation } from "@/server/features/approvals/rules";

export interface SkillConflictResolution {
  reasonCode: string;
  userMessage: string;
  suggestedAlternative?: string;
}

function getSuggestedAlternative(capability: CapabilityName): string | undefined {
  if (
    capability === "email.batchTrash" ||
    capability === "calendar.deleteEvent" ||
    capability === "email.markSpam"
  ) {
    return "Use a non-destructive alternative such as archive first, then permanently remove after confirmation.";
  }

  if (
    capability === "email.sendNow" ||
    capability === "email.sendDraft" ||
    capability === "email.reply" ||
    capability === "email.forward"
  ) {
    return "Create or update a draft first, then approve send.";
  }

  return undefined;
}

export function resolvePolicyConflict(params: {
  capability: CapabilityName;
  approval: ApprovalEvaluation;
}): SkillConflictResolution {
  const suggestedAlternative = getSuggestedAlternative(params.capability);
  const operation = params.approval.target.operation;
  const resource = params.approval.target.resource ?? "resource";

  const base =
    "This action is blocked by your current approval policy and was not executed.";
  const policyMessage =
    params.approval.source === "rule"
      ? `Matched policy rule: "${params.approval.matchedRule?.name ?? "unnamed_rule"}".`
      : `Default policy requires approval for ${operation} on ${resource}.`;

  return {
    reasonCode: "policy_conflict",
    userMessage: `${base} ${policyMessage}`,
    ...(suggestedAlternative ? { suggestedAlternative } : {}),
  };
}

