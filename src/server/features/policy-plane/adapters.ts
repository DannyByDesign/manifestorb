import type {
  ApprovalRule,
  ApprovalRuleConditions,
} from "@/features/approvals/rules";
import type {
  Action,
  CalendarEventPolicy,
  Rule,
  TaskPreference,
  UserAIConfig,
} from "@/generated/prisma/client";
import { ActionType } from "@/generated/prisma/enums";
import type { CanonicalRule, CanonicalRuleType } from "@/server/features/policy-plane/canonical-schema";

type CanonicalCondition = CanonicalRule["match"]["conditions"][number];

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  return value.toISOString();
}

function conditionIfDefined(
  field: string,
  op: "eq" | "contains",
  value: unknown,
): CanonicalCondition[] {
  if (typeof value !== "string" || value.trim().length === 0) return [];
  return [{ field, op, value: value.trim() }];
}

function mapApprovalConditionsToCanonical(
  conditions: ApprovalRuleConditions | undefined,
): CanonicalCondition[] {
  if (!conditions) return [];
  const mapped: CanonicalCondition[] = [];
  if (conditions.externalOnly !== undefined) {
    mapped.push({
      field: "actor.recipient.externalOnly",
      op: "eq",
      value: conditions.externalOnly,
    });
  }
  if (conditions.domains && conditions.domains.length > 0) {
    mapped.push({
      field: "actor.recipient.domain",
      op: "in",
      value: conditions.domains,
    });
  }
  if (conditions.minItemCount !== undefined) {
    mapped.push({
      field: "target.itemCount",
      op: "gte",
      value: conditions.minItemCount,
    });
  }
  if (conditions.maxItemCount !== undefined) {
    mapped.push({
      field: "target.itemCount",
      op: "lte",
      value: conditions.maxItemCount,
    });
  }
  return mapped;
}

export function adaptApprovalRuleToCanonical(params: {
  userId: string;
  toolName: string;
  defaultPolicy: "always" | "never" | "conditional";
  rule: ApprovalRule;
}): CanonicalRule {
  const mappedDecision =
    params.rule.policy === "always"
      ? "require_approval"
      : params.rule.policy === "never"
        ? "allow"
        : "require_approval";
  const resource = (params.rule.resource || "email") as
    | "email"
    | "calendar"
    | "task"
    | "rule"
    | "preference"
    | "workflow";
  return {
    id: `legacy-approval:${params.toolName}:${params.rule.id}`,
    version: 1,
    type: "guardrail",
    enabled: params.rule.enabled ?? true,
    priority: params.rule.priority ?? 0,
    name: params.rule.name,
    description: `Migrated approval rule for ${params.toolName}`,
    scope: {
      surfaces: ["web", "slack", "discord", "telegram", "system"],
      resources: [resource],
    },
    match: {
      resource,
      operation: params.rule.operation || params.toolName,
      conditions: mapApprovalConditionsToCanonical(params.rule.conditions),
    },
    decision: mappedDecision,
    source: {
      mode: "migration",
      compilerWarnings:
        params.defaultPolicy === "conditional" && !params.rule.conditions
          ? ["Legacy conditional policy had no explicit conditions."]
          : undefined,
    },
    disabledUntil: params.rule.disabledUntil,
    legacyRefType: "ApprovalPreference",
    legacyRefId: params.rule.id,
  };
}

function actionToCanonicalOperation(action: Action): string | null {
  switch (action.type) {
    case ActionType.ARCHIVE:
      return "archive_email";
    case ActionType.MARK_SPAM:
      return "trash_email";
    case ActionType.MARK_READ:
    case ActionType.LABEL:
    case ActionType.MOVE_FOLDER:
      return "update_email";
    case ActionType.DRAFT_EMAIL:
      return "create_email_draft";
    case ActionType.SEND_EMAIL:
    case ActionType.REPLY:
    case ActionType.FORWARD:
      return "send_email";
    case ActionType.CREATE_CALENDAR_EVENT:
    case ActionType.SCHEDULE_MEETING:
      return "create_calendar_event";
    case ActionType.CREATE_TASK:
      return "create_task";
    case ActionType.SET_TASK_PREFERENCES:
      return "update_preferences";
    case ActionType.CALL_WEBHOOK:
      return "run_workflow";
    case ActionType.DIGEST:
    case ActionType.NOTIFY_USER:
    case ActionType.NOTIFY_SENDER:
      return "notify";
    default:
      return null;
  }
}

export function adaptEmailRuleToCanonical(params: {
  userId: string;
  emailAccountId: string;
  rule: Rule & { actions: Action[] };
}): CanonicalRule {
  const operations = params.rule.actions
    .map(actionToCanonicalOperation)
    .filter((value): value is string => typeof value === "string");

  const actionPlan = {
    actions: params.rule.actions.map((action) => ({
      actionType: action.type,
      args: {
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
        payload: action.payload,
      },
      idempotencyScope: "message" as const,
    })),
  };

  return {
    id: `legacy-email-rule:${params.rule.id}`,
    version: 1,
    type: "automation",
    enabled: params.rule.enabled,
    priority: 0,
    name: params.rule.name,
    description: "Migrated inbox automation rule",
    scope: {
      surfaces: ["system", "web"],
      resources: ["email", "calendar", "task"],
    },
    trigger: {
      kind: "event",
      eventType: "email.received",
    },
    match: {
      resource: "email",
      operation: operations[0] || "update_email",
      conditions: [
        ...conditionIfDefined("email.sender", "contains", params.rule.from ?? undefined),
        ...conditionIfDefined("email.recipient", "contains", params.rule.to ?? undefined),
        ...conditionIfDefined("email.subject", "contains", params.rule.subject ?? undefined),
        ...conditionIfDefined("email.body", "contains", params.rule.body ?? undefined),
      ],
    },
    actionPlan,
    source: { mode: "migration" },
    expiresAt: toIso(params.rule.expiresAt),
    legacyRefType: "Rule",
    legacyRefId: params.rule.id,
  };
}

export function adaptCalendarPolicyToCanonical(params: {
  userId: string;
  emailAccountId: string;
  policy: CalendarEventPolicy;
}): CanonicalRule {
  const conditions: CanonicalCondition[] = params.policy.shadowEventId
    ? [
        {
          field: "calendar.shadowEventId",
          op: "eq",
          value: params.policy.shadowEventId,
        },
      ]
    : [];
  const decision =
    params.policy.reschedulePolicy === "APPROVAL_REQUIRED"
      ? "require_approval"
      : params.policy.reschedulePolicy === "FIXED"
        ? "block"
        : "allow";

  return {
    id: `legacy-calendar-policy:${params.policy.id}`,
    version: 1,
    type: "guardrail",
    enabled: true,
    priority: params.policy.priority ?? 0,
    name: params.policy.title ?? "Calendar policy",
    description: "Migrated calendar event policy",
    scope: {
      surfaces: ["web", "slack", "discord", "telegram", "system"],
      resources: ["calendar"],
    },
    match: {
      resource: "calendar",
      operation: "reschedule_event",
      conditions,
    },
    decision,
    source: { mode: "migration" },
    disabledUntil: toIso(params.policy.disabledUntil),
    expiresAt: toIso(params.policy.expiresAt),
    legacyRefType: "CalendarEventPolicy",
    legacyRefId: params.policy.id,
  };
}

export function adaptTaskPreferenceToCanonical(params: {
  userId: string;
  emailAccountId?: string;
  taskPreference: TaskPreference | null;
  aiConfig: UserAIConfig | null;
}): CanonicalRule[] {
  const rules: CanonicalRule[] = [];
  if (params.taskPreference) {
    rules.push({
      id: `legacy-task-preference:${params.taskPreference.userId}`,
      version: 1,
      type: "preference",
      enabled: true,
      priority: 1000,
      name: "Scheduling preferences",
      description: "Migrated scheduling preferences",
      scope: {
        surfaces: ["web", "slack", "discord", "telegram", "system"],
        resources: ["calendar", "preference"],
      },
      match: {
        resource: "calendar",
        operation: "create_or_reschedule",
        conditions: [],
      },
      preferencePatch: {
        updates: [
          { key: "calendar.workingHours.start", value: params.taskPreference.workHourStart },
          { key: "calendar.workingHours.end", value: params.taskPreference.workHourEnd },
          { key: "calendar.workingHours.days", value: params.taskPreference.workDays },
          { key: "calendar.bufferMinutes", value: params.taskPreference.bufferMinutes },
          {
            key: "calendar.defaultMeetingDurationMin",
            value: params.taskPreference.defaultMeetingDurationMin,
          },
          { key: "calendar.timeZone", value: params.taskPreference.timeZone ?? undefined },
        ],
      },
      source: { mode: "migration" },
      legacyRefType: "TaskPreference",
      legacyRefId: params.taskPreference.id,
    });
  }

  if (params.aiConfig) {
    rules.push({
      id: `legacy-ai-config:${params.aiConfig.userId}`,
      version: 1,
      type: "preference",
      enabled: true,
      priority: 900,
      name: "Assistant execution preferences",
      description: "Migrated AI configuration preferences",
      scope: {
        surfaces: ["web", "slack", "discord", "telegram", "system"],
        resources: ["preference"],
      },
      match: {
        resource: "preference",
        operation: "planner_execution",
        conditions: [],
      },
      preferencePatch: {
        updates: [
          { key: "ai.maxSteps", value: params.aiConfig.maxSteps ?? undefined },
          {
            key: "ai.defaultApprovalExpirySeconds",
            value: params.aiConfig.defaultApprovalExpirySeconds ?? undefined,
          },
          {
            key: "ai.conversationCategories",
            value: params.aiConfig.conversationCategories,
          },
        ],
      },
      source: { mode: "migration" },
      legacyRefType: "UserAIConfig",
      legacyRefId: params.aiConfig.id,
    });
  }

  return rules;
}

export function matchesRuleType(
  rule: CanonicalRule,
  type: CanonicalRuleType | undefined,
): boolean {
  if (!type) return true;
  return rule.type === type;
}
