import prisma from "@/server/db/client";
import { ActionType, ExecutedRuleStatus } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import type { ParsedMessage } from "@/server/lib/types";
import type { EmailProvider } from "@/features/email/types";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { CanonicalRule } from "@/server/features/policy-plane/canonical-schema";
import { isRuleActiveNow } from "@/server/features/policy-plane/canonical-schema";
import { listEffectiveCanonicalRules } from "@/server/features/policy-plane/repository";
import type { Logger } from "@/server/lib/logger";
import { runActionFunction } from "@/features/ai/actions";

type CanonicalAutomationExecutionResult = {
  ruleId: string;
  status: "applied" | "skipped" | "error";
  reason: string;
  executedRuleId?: string;
  actionTypes: ActionType[];
};

function conditionValue(message: ParsedMessage, field: string): unknown {
  switch (field) {
    case "email.sender":
      return message.headers.from;
    case "email.recipient":
      return message.headers.to;
    case "email.subject":
      return message.headers.subject ?? message.subject;
    case "email.body":
      return `${message.textPlain ?? ""}\n${message.textHtml ?? ""}\n${message.snippet ?? ""}`;
    case "email.messageId":
      return message.id;
    case "email.threadId":
      return message.threadId;
    case "email.labelIds":
      return message.labelIds ?? [];
    default:
      return undefined;
  }
}

function compareCondition(params: {
  op: string;
  actual: unknown;
  expected: unknown;
}): boolean {
  const { op, actual, expected } = params;
  switch (op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "not_in":
      return Array.isArray(expected) && !expected.includes(actual);
    case "contains":
      return typeof actual === "string" && typeof expected === "string"
        ? actual.toLowerCase().includes(expected.toLowerCase())
        : Array.isArray(actual)
          ? actual.includes(expected)
          : false;
    case "regex":
      if (typeof actual !== "string" || typeof expected !== "string") return false;
      try {
        return new RegExp(expected, "iu").test(actual);
      } catch {
        return false;
      }
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "exists":
      return actual !== undefined && actual !== null;
    default:
      return false;
  }
}

function matchesEmailAutomationRule(message: ParsedMessage, rule: CanonicalRule): boolean {
  if (!isRuleActiveNow(rule)) return false;
  if (rule.type !== "automation") return false;
  if (!rule.trigger || rule.trigger.kind !== "event") return false;
  if (rule.trigger.eventType !== "email.received") return false;
  if (rule.match.resource !== "email") return false;

  return rule.match.conditions.every((condition) =>
    compareCondition({
      op: condition.op,
      actual: conditionValue(message, condition.field),
      expected: condition.value,
    }),
  );
}

function normalizeActionType(value: string): ActionType | null {
  const normalized = value.trim();
  if (!normalized) return null;

  const direct = (ActionType as Record<string, string>)[normalized];
  if (typeof direct === "string") {
    return direct as ActionType;
  }

  const key = normalized.toLowerCase();
  switch (key) {
    case "archive_email":
      return ActionType.ARCHIVE;
    case "trash_email":
    case "delete_email":
      return ActionType.MARK_SPAM;
    case "update_email":
      return ActionType.MARK_READ;
    case "send_email":
      return ActionType.SEND_EMAIL;
    case "create_email_draft":
      return ActionType.DRAFT_EMAIL;
    case "create_calendar_event":
      return ActionType.CREATE_CALENDAR_EVENT;
    case "create_task":
      return ActionType.CREATE_TASK;
    case "update_preferences":
      return ActionType.SET_TASK_PREFERENCES;
    case "run_workflow":
      return ActionType.CALL_WEBHOOK;
    case "notify":
      return ActionType.NOTIFY_USER;
    default:
      return null;
  }
}

function toCsv(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const out = value.filter((item): item is string => typeof item === "string");
    return out.length > 0 ? out.join(",") : undefined;
  }
  return undefined;
}

function toExecutedActionInput(action: {
  actionType: string;
  args: Record<string, unknown>;
}): {
  type: ActionType;
  label?: string;
  labelId?: string;
  subject?: string;
  content?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  url?: string;
  folderName?: string;
  folderId?: string;
  payload?: Record<string, unknown>;
} | null {
  const type = normalizeActionType(action.actionType);
  if (!type) return null;
  const args = action.args ?? {};
  return {
    type,
    ...(typeof args.label === "string" ? { label: args.label } : {}),
    ...(typeof args.labelId === "string" ? { labelId: args.labelId } : {}),
    ...(typeof args.subject === "string" ? { subject: args.subject } : {}),
    ...(typeof args.content === "string" ? { content: args.content } : {}),
    ...(toCsv(args.to) ? { to: toCsv(args.to) } : {}),
    ...(toCsv(args.cc) ? { cc: toCsv(args.cc) } : {}),
    ...(toCsv(args.bcc) ? { bcc: toCsv(args.bcc) } : {}),
    ...(typeof args.url === "string" ? { url: args.url } : {}),
    ...(typeof args.folderName === "string" ? { folderName: args.folderName } : {}),
    ...(typeof args.folderId === "string" ? { folderId: args.folderId } : {}),
    payload: args,
  };
}

function toNullableJsonInput(
  value: Record<string, unknown> | undefined,
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
}

export async function executeCanonicalEmailAutomations(params: {
  provider: EmailProvider;
  message: ParsedMessage;
  emailAccount: EmailAccountWithAI;
  logger: Logger;
  skipActionTypes?: ActionType[];
}): Promise<CanonicalAutomationExecutionResult[]> {
  const rules = await listEffectiveCanonicalRules({
    userId: params.emailAccount.userId,
    emailAccountId: params.emailAccount.id,
    type: "automation",
  });

  const matches = rules.filter((rule) => matchesEmailAutomationRule(params.message, rule));
  if (matches.length === 0) return [];

  const results: CanonicalAutomationExecutionResult[] = [];

  for (const rule of matches) {
    const actions = Array.isArray(rule.actionPlan?.actions)
      ? rule.actionPlan.actions
      : [];
    const normalized = actions
      .map((action) =>
        toExecutedActionInput({
          actionType: action.actionType,
          args:
            action.args && typeof action.args === "object" && !Array.isArray(action.args)
              ? (action.args as Record<string, unknown>)
              : {},
        }),
      )
      .filter((action) =>
        action ? !params.skipActionTypes?.includes(action.type) : true,
      )
      .filter((action): action is NonNullable<typeof action> => Boolean(action));

    if (normalized.length === 0) {
      results.push({
        ruleId: rule.id,
        status: "skipped",
        reason: "no_supported_actions",
        actionTypes: [],
      });
      continue;
    }

    const createdExecutedRule = await prisma.executedRule.create({
      data: {
        threadId: params.message.threadId,
        messageId: params.message.id,
        status: ExecutedRuleStatus.APPLIED,
        automated: true,
        reason: rule.description ?? `Canonical automation rule ${rule.id}`,
        matchMetadata: {
          canonicalRuleId: rule.id,
          sourceMode: rule.source.mode,
        },
        emailAccount: { connect: { id: params.emailAccount.id } },
        actionItems: {
          createMany: {
            data: normalized.map((action) => ({
              type: action.type,
              label: action.label,
              labelId: action.labelId,
              subject: action.subject,
              content: action.content,
              to: action.to,
              cc: action.cc,
              bcc: action.bcc,
              url: action.url,
              folderName: action.folderName,
              folderId: action.folderId,
              payload: toNullableJsonInput(action.payload),
            })),
          },
        },
      },
    });

    const executedRule = await prisma.executedRule.findUnique({
      where: { id: createdExecutedRule.id },
      include: { actionItems: true },
    });
    if (!executedRule) {
      results.push({
        ruleId: rule.id,
        status: "error",
        reason: "executed_rule_not_found",
        executedRuleId: createdExecutedRule.id,
        actionTypes: normalized.map((action) => action.type),
      });
      continue;
    }

    try {
      for (const action of executedRule.actionItems) {
        const actionResult = await runActionFunction({
          client: params.provider,
          email: params.message,
          action,
          userEmail: params.emailAccount.email,
          userId: params.emailAccount.userId,
          emailAccountId: params.emailAccount.id,
          executedRule,
          logger: params.logger,
          policySource: "automation",
        });

        const isDeferredForApproval =
          typeof actionResult === "object" &&
          actionResult !== null &&
          "approvalRequested" in actionResult &&
          actionResult.approvalRequested === true;
        const isBlockedByPolicy =
          typeof actionResult === "object" &&
          actionResult !== null &&
          "blockedByPolicy" in actionResult &&
          actionResult.blockedByPolicy === true;
        if (isDeferredForApproval || isBlockedByPolicy) {
          continue;
        }

        const draftId =
          typeof actionResult === "object" &&
          actionResult !== null &&
          "draftId" in actionResult &&
          typeof actionResult.draftId === "string"
            ? actionResult.draftId
            : null;
        if (draftId && action.type === ActionType.DRAFT_EMAIL) {
          await prisma.executedAction.update({
            where: { id: action.id },
            data: { draftId },
          });
        }
      }
      await prisma.executedRule.update({
        where: { id: executedRule.id },
        data: { status: ExecutedRuleStatus.APPLIED },
      });
      results.push({
        ruleId: rule.id,
        status: "applied",
        reason: "executed",
        executedRuleId: executedRule.id,
        actionTypes: normalized.map((action) => action.type),
      });
    } catch (error) {
      params.logger.error("Canonical automation execution failed", {
        canonicalRuleId: rule.id,
        error,
      });
      await prisma.executedRule.update({
        where: { id: executedRule.id },
        data: { status: ExecutedRuleStatus.ERROR },
      });
      results.push({
        ruleId: rule.id,
        status: "error",
        reason: error instanceof Error ? error.message : "execution_failed",
        executedRuleId: executedRule.id,
        actionTypes: normalized.map((action) => action.type),
      });
    }
  }

  return results;
}
