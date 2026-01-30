import { ActionType, ExecutedRuleStatus } from "@/generated/prisma/enums";
import type { Rule } from "@/generated/prisma/client";
import {
  type RuleWithConditions,
  RiskLevel,
  RISK_LEVELS,
} from "@/utils/risk";
import type { ParsedMessage } from "@/utils/types";
import type { Logger } from "@/utils/logger";
import { type EmailForAction } from "@/utils/ai/types";
import type { EmailProvider } from "@/server/services/email/types";

// Mocking types
export type RuleWithActions = any;
export type EmailAccountWithAI = any;
export type ModelType = "chat" | "test";
export type MatchReason = any;
export type ActionItem = any;

// Mocking Delayed Actions
export const scheduleDelayedActions = async (...args: any[]) => { }
export const cancelScheduledActions = async (...args: any[]) => { }

// Mocking RuleAction
export type RuleAction = any;
export const CONVERSATION_TRACKING_META_RULE_ID = "conversation-tracking";
export const ensureConversationRuleContinuity = async ({ matches }: any) => { return matches; };
export const limitDraftEmailActions = (matches: any, _logger?: any) => { return matches; };

export type RunRulesResult = {
  rule?: Pick<
    Rule,
    | "id"
    | "name"
    | "instructions"
    | "groupId"
    | "from"
    | "to"
    | "subject"
    | "body"
    | "conditionalOperator"
  > | null;
  actionItems?: ActionItem[];
  reason?: string | null;
  status: ExecutedRuleStatus;
  matchReasons?: MatchReason[];
  existing?: boolean;
  createdAt: Date;
};

export async function runRules({
  provider,
  message,
  rules,
  emailAccount,
  isTest,
  modelType,
  logger,
  skipArchive,
}: {
  provider: EmailProvider;
  message: ParsedMessage;
  rules: RuleWithActions[];
  emailAccount: EmailAccountWithAI;
  isTest: boolean;
  modelType: ModelType;
  logger: Logger;
  skipArchive?: boolean;
}): Promise<RunRulesResult[]> {
  // Mock implementation
  return [];
}
