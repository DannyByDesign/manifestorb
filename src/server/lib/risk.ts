import { LogicalOperator, ActionType } from "@/generated/prisma/enums";
import type { Action } from "@/generated/prisma/client";
import { isAIRule, type RuleConditions } from "@/server/lib/condition";
import { TEMPLATE_VARIABLE_PATTERN } from "@/server/lib/template";

export const RISK_LEVELS = {
  VERY_HIGH: "very-high",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

export type RiskLevel = (typeof RISK_LEVELS)[keyof typeof RISK_LEVELS];

export type RiskAction = Pick<
  Action,
  "type" | "subject" | "content" | "to" | "cc" | "bcc"
>;

export type RuleWithConditions = RuleConditions & {
  actions: RiskAction[];
};

export type RuleConditionInput = {
  from?: string | null;
  to?: string | null;
  subject?: string | null;
  body?: string | null;
};

function matchesPattern(
  value: string | null | undefined,
  pattern: string | null | undefined,
): boolean {
  if (!pattern) return true;
  if (!value) return false;

  const normalizedValue = value.toLowerCase();
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!normalizedPattern) return true;

  if (normalizedPattern.startsWith("/") && normalizedPattern.endsWith("/") && normalizedPattern.length > 2) {
    try {
      const regex = new RegExp(normalizedPattern.slice(1, -1), "i");
      return regex.test(value);
    } catch {
      return normalizedValue.includes(normalizedPattern);
    }
  }

  return normalizedValue.includes(normalizedPattern);
}

/**
 * Evaluate non-AI/static portions of rule conditions against a message-like input.
 * AI-instruction conditions are intentionally treated as non-blocking here because
 * they require model evaluation in rule matching pipelines.
 */
export async function checkRuleConditions(
  rule: RuleConditions,
  input: RuleConditionInput,
): Promise<boolean> {
  const checks: boolean[] = [];

  if (rule.from) checks.push(matchesPattern(input.from, rule.from));
  if (rule.to) checks.push(matchesPattern(input.to, rule.to));
  if (rule.subject) checks.push(matchesPattern(input.subject, rule.subject));
  if (rule.body) checks.push(matchesPattern(input.body, rule.body));

  if (checks.length === 0) {
    // Pure AI rules (instructions only) are evaluated elsewhere.
    return true;
  }

  const operator = rule.conditionalOperator ?? LogicalOperator.AND;
  return operator === LogicalOperator.OR
    ? checks.some(Boolean)
    : checks.every(Boolean);
}

export function getActionRiskLevel(
  action: RiskAction,
  rule: RuleConditions,
): {
  level: RiskLevel;
  message: string;
} {
  const highRiskActions = [
    ActionType.REPLY,
    ActionType.FORWARD,
    ActionType.SEND_EMAIL,
  ];
  if (!highRiskActions.some((type) => type === action.type)) {
    return {
      level: RISK_LEVELS.LOW,
      message: "Low Risk: No email sending action is performed.",
    };
  }

  const fieldStatus = getFieldsDynamicStatus(action);

  const contentFields = [fieldStatus.subject, fieldStatus.content];
  const recipientFields = [fieldStatus.to, fieldStatus.cc, fieldStatus.bcc];

  const hasFullyDynamicContent = hasAnyFieldWithStatus(
    contentFields,
    "fully-dynamic",
  );
  const hasPartiallyDynamicContent = hasAnyFieldWithStatus(
    contentFields,
    "partially-dynamic",
  );

  const hasFullyDynamicRecipient = hasAnyFieldWithStatus(
    recipientFields,
    "fully-dynamic",
  );
  const hasPartiallyDynamicRecipient = hasAnyFieldWithStatus(
    recipientFields,
    "partially-dynamic",
  );

  // All rules are now automated, so we always check for dynamic content risks
  if (hasFullyDynamicContent && hasFullyDynamicRecipient) {
    const level = isAIRule(rule) ? RISK_LEVELS.VERY_HIGH : RISK_LEVELS.HIGH;
    return {
      level,
      message: `${level === RISK_LEVELS.VERY_HIGH ? "Very High" : "High"} Risk: The AI can generate any content and send it to any address. A malicious actor could trick the AI to send spam or other unwanted emails on your behalf.`,
    };
  }

  if (hasFullyDynamicRecipient) {
    return {
      level: RISK_LEVELS.HIGH,
      message:
        "High Risk: The AI can send emails to any address. A malicious actor could use this to send spam or other unwanted emails on your behalf.",
    };
  }

  if (hasFullyDynamicContent) {
    return {
      level: RISK_LEVELS.HIGH,
      message:
        "High Risk: The AI can automatically generate and send any email content. A malicious actor could potentially trick the AI into generating unwanted or inappropriate content.",
    };
  }

  if (hasPartiallyDynamicContent || hasPartiallyDynamicRecipient) {
    return {
      level: RISK_LEVELS.MEDIUM,
      message:
        "Medium Risk: The AI can generate content or recipients using templates. While more constrained than fully dynamic content, review the templates carefully.",
    };
  }

  return {
    level: RISK_LEVELS.LOW,
    message: "Low Risk: All content and recipients are static.",
  };
}

function hasAnyFieldWithStatus(
  fields: Array<FieldDynamicStatus>,
  status: "fully-dynamic" | "partially-dynamic",
) {
  return fields.some((field) => field === status);
}

function compareRiskLevels(a: RiskLevel, b: RiskLevel): RiskLevel {
  const riskOrder: Record<RiskLevel, number> = {
    [RISK_LEVELS.VERY_HIGH]: 4,
    [RISK_LEVELS.HIGH]: 3,
    [RISK_LEVELS.MEDIUM]: 2,
    [RISK_LEVELS.LOW]: 1,
  };
  return riskOrder[a] >= riskOrder[b] ? a : b;
}

export function getRiskLevel(rule: RuleWithConditions): {
  level: RiskLevel;
  message: string;
} {
  return rule.actions.reduce<{ level: RiskLevel; message: string }>(
    (highestRisk, action) => {
      const actionRisk = getActionRiskLevel(action, rule);
      return compareRiskLevels(actionRisk.level, highestRisk.level) ===
        actionRisk.level
        ? actionRisk
        : highestRisk;
    },
    {
      level: RISK_LEVELS.LOW,
      message: "Low Risk: All content and recipients are static.",
    },
  );
}

type FieldDynamicStatus =
  | "fully-dynamic"
  | "partially-dynamic"
  | "static"
  | null;

function getFieldsDynamicStatus(action: RiskAction) {
  const checkFieldStatus = (field: string | null): FieldDynamicStatus => {
    if (!field) return null;
    if (isFullyDynamicField(field)) return "fully-dynamic";
    if (isPartiallyDynamicField(field)) return "partially-dynamic";
    return "static";
  };

  return {
    subject: checkFieldStatus(action.subject),
    content: checkFieldStatus(action.content),
    to: checkFieldStatus(action.to),
    cc: checkFieldStatus(action.cc),
    bcc: checkFieldStatus(action.bcc),
  };
}

export function isFullyDynamicField(field: string) {
  const trimmed = field.trim();
  return trimmed.startsWith("{{") && trimmed.endsWith("}}");
}

export function isPartiallyDynamicField(field: string) {
  return new RegExp(TEMPLATE_VARIABLE_PATTERN).test(field);
}
