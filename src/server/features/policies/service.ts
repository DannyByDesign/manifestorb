import { listApprovalRuleConfigs } from "@/features/approvals/rules";
import { getAssistantPreferenceSnapshot } from "@/features/preferences/service";
import { listRulePlaneSnapshot } from "@/server/features/policy-plane/service";

export async function listAssistantPolicies(params: {
  userId: string;
  emailAccountId: string;
}) {
  const [preferences, rulePlane, approvalRuleConfigs] = await Promise.all([
    getAssistantPreferenceSnapshot({
      userId: params.userId,
      emailAccountId: params.emailAccountId,
    }),
    listRulePlaneSnapshot({
      userId: params.userId,
      emailAccountId: params.emailAccountId,
    }),
    listApprovalRuleConfigs({ userId: params.userId }),
  ]);

  const emailRules = rulePlane.rules
    .filter((rule) => rule.type === "automation")
    .map((rule) => ({
      id: rule.id,
      name: rule.name ?? "Untitled automation",
      enabled: rule.enabled,
      priority: rule.priority,
      disabledUntil: rule.disabledUntil ?? null,
      trigger: rule.trigger,
      match: rule.match,
      actionPlan: rule.actionPlan ?? null,
      source: rule.source,
    }));

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
    rulePlaneRules: rulePlane.rules,
    approvalRuleConfigs,
    approvalRules,
    summary: {
      emailRuleCount: emailRules.length,
      approvalRuleCount: approvalRules.length,
    },
  };
}
