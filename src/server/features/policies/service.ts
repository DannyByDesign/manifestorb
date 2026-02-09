import { listApprovalRuleConfigs } from "@/features/approvals/rules";
import { listEmailRules } from "@/features/rules/management";
import { getAssistantPreferenceSnapshot } from "@/features/preferences/service";

export async function listAssistantPolicies(params: {
  userId: string;
  emailAccountId: string;
}) {
  const [preferences, emailRules, approvalRuleConfigs] = await Promise.all([
    getAssistantPreferenceSnapshot({
      userId: params.userId,
      emailAccountId: params.emailAccountId,
    }),
    listEmailRules(params.emailAccountId),
    listApprovalRuleConfigs({ userId: params.userId }),
  ]);

  const approvalRules = approvalRuleConfigs.flatMap((config) =>
    config.rules.map((rule) => ({
      ...rule,
      toolName: config.toolName,
      defaultPolicy: config.defaultPolicy,
    })),
  );

  return {
    preferences,
    emailRules,
    approvalRuleConfigs,
    approvalRules,
    summary: {
      emailRuleCount: emailRules.length,
      approvalRuleCount: approvalRules.length,
    },
  };
}
