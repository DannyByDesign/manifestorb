import { SystemType } from "@/generated/prisma/enums";

export type RuleWithActions = {
  systemType: SystemType | null;
  enabled: boolean;
};

export function isColdEmailBlockerEnabled(rules: RuleWithActions[]) {
  return rules.some(
    (rule) => rule.systemType === SystemType.COLD_EMAIL && rule.enabled,
  );
}
