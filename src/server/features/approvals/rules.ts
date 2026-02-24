import { randomUUID } from "crypto";
import prisma from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";

export type ApprovalPolicy = "always" | "never" | "conditional";

export interface ApprovalRuleConditions {
  externalOnly?: boolean;
  domains?: string[];
  minItemCount?: number;
  maxItemCount?: number;
}

export interface ApprovalRule {
  id: string;
  name: string;
  policy: ApprovalPolicy;
  resource?: string;
  operation?: string;
  enabled?: boolean;
  disabledUntil?: string;
  createdAt?: string;
  priority?: number;
  conditions?: ApprovalRuleConditions;
}

interface ApprovalRuleConfig {
  version: 2;
  defaultPolicy: ApprovalPolicy;
  defaultConditions?: ApprovalRuleConditions;
  rules: ApprovalRule[];
}

export interface ApprovalTarget {
  toolName: string;
  resource?: string;
  operation: string;
  itemCount: number;
  recipientEmails: string[];
}

export interface ApprovalEvaluation {
  requiresApproval: boolean;
  matchedRule?: ApprovalRule;
  source: "default" | "rule";
  target: ApprovalTarget;
}

const APPROVAL_OPERATION_LABELS: Record<string, string> = {
  send_email: "Send email",
  draft_and_send: "Send draft immediately",
  create_email_draft: "Create email draft",
  create_reply_draft: "Create reply draft",
  create_forward_draft: "Create forward draft",
  create_calendar_event: "Create calendar event",
  schedule_proposal: "Create scheduling proposal",
  create_task: "Create task",
  create_automation: "Create automation rule",
  create_knowledge: "Create knowledge entry",
  delete_email: "Delete emails",
  delete_calendar_event: "Delete calendar events",
  delete_task: "Delete tasks",
  delete_automation: "Delete automation rules",
  delete_knowledge: "Delete knowledge entries",
  update_email: "Update email state",
  trash_email: "Move email to trash",
  restore_email: "Restore email from trash",
  archive_email: "Archive email",
  unsubscribe_sender: "Unsubscribe sender",
  bulk_trash_senders: "Trash emails by sender",
  bulk_archive_senders: "Archive emails by sender",
  bulk_label_senders: "Label emails by sender",
  update_calendar_event: "Update calendar event",
  update_task: "Update task",
  update_preferences: "Update preferences",
  approval_rules: "Update approval rules",
  update_automation: "Update automation rule",
  approval_decision: "Approve/deny request",
  run_workflow: "Run workflow",
  manage_rules: "Manage rules",
  triage_tasks: "Triage tasks",
  query: "Query data",
  get: "Get details",
  analyze: "Analyze data",
};

export function listApprovalOperationKeys(): string[] {
  return Object.keys(APPROVAL_OPERATION_LABELS).sort();
}

export function getApprovalOperationLabel(operation: string): string {
  return APPROVAL_OPERATION_LABELS[operation] ?? operation.replace(/_/g, " ");
}

export function normalizeApprovalOperationKey(operation: string | undefined): string | undefined {
  if (!operation) return undefined;
  const normalized = operation.trim().toLowerCase().replace(/\s+/g, "_");
  if (APPROVAL_OPERATION_LABELS[normalized]) return normalized;
  const byLabel = Object.keys(APPROVAL_OPERATION_LABELS).find(
    (key) => APPROVAL_OPERATION_LABELS[key]?.toLowerCase() === operation.trim().toLowerCase(),
  );
  return byLabel ?? normalized;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreMatch(haystack: string, query: string): number {
  const lhs = haystack.toLowerCase();
  const rhs = query.toLowerCase().trim();
  if (!rhs) return 0;
  if (lhs === rhs) return 100;
  if (lhs.startsWith(rhs)) return 90;
  if (lhs.includes(rhs)) return 80;
  const leftTokens = tokenize(lhs);
  const rightTokens = tokenize(rhs);
  if (rightTokens.length === 0) return 0;
  const matched = rightTokens.filter((token) =>
    leftTokens.some((candidate) => candidate.includes(token) || token.includes(candidate)),
  ).length;
  return Math.floor((matched / rightTokens.length) * 70);
}

const DEFAULT_TOOL_CONFIG: Record<string, ApprovalRuleConfig> = {
  query: { version: 2, defaultPolicy: "never", rules: [] },
  get: { version: 2, defaultPolicy: "never", rules: [] },
  analyze: { version: 2, defaultPolicy: "never", rules: [] },
  triage: { version: 2, defaultPolicy: "never", rules: [] },
  create: { version: 2, defaultPolicy: "never", rules: [] },
  workflow: { version: 2, defaultPolicy: "never", rules: [] },
  rules: { version: 2, defaultPolicy: "never", rules: [] },
  send: { version: 2, defaultPolicy: "always", rules: [] },
  delete: {
    version: 2,
    defaultPolicy: "never",
    rules: [
      {
        id: "default-delete-calendar",
        name: "Delete calendar events requires approval",
        policy: "always",
        resource: "calendar",
        operation: "delete_calendar_event",
        priority: 100,
      },
      {
        id: "default-delete-task",
        name: "Delete tasks requires approval",
        policy: "always",
        resource: "task",
        operation: "delete_task",
        priority: 95,
      },
      {
        id: "default-delete-automation",
        name: "Delete automations requires approval",
        policy: "always",
        resource: "automation",
        operation: "delete_automation",
        priority: 95,
      },
      {
        id: "default-delete-knowledge",
        name: "Delete knowledge entries requires approval",
        policy: "always",
        resource: "knowledge",
        operation: "delete_knowledge",
        priority: 95,
      },
      {
        id: "default-delete-email-bulk",
        name: "Bulk email deletion requires approval",
        policy: "always",
        resource: "email",
        operation: "delete_email",
        priority: 90,
        conditions: {
          minItemCount: 25,
        },
      },
    ],
  },
  modify: {
    version: 2,
    defaultPolicy: "never",
    rules: [
      {
        id: "default-modify-email-trash",
        name: "Moving email to trash requires approval",
        policy: "always",
        resource: "email",
        operation: "trash_email",
        priority: 100,
      },
      {
        id: "default-modify-email-restore",
        name: "Restoring email from trash requires approval",
        policy: "always",
        resource: "email",
        operation: "restore_email",
        priority: 98,
      },
      {
        id: "default-modify-email-bulk-trash",
        name: "Bulk sender trash requires approval",
        policy: "always",
        resource: "email",
        operation: "bulk_trash_senders",
        priority: 100,
      },
      {
        id: "default-modify-email-unsubscribe",
        name: "Unsubscribe actions require approval",
        policy: "always",
        resource: "email",
        operation: "unsubscribe_sender",
        priority: 95,
      },
      {
        id: "default-modify-task-bulk",
        name: "Bulk task updates require approval",
        policy: "always",
        resource: "task",
        operation: "update_task",
        priority: 85,
        conditions: {
          minItemCount: 10,
        },
      },
      {
        id: "default-modify-automation",
        name: "Automation/rule updates require approval",
        policy: "always",
        resource: "automation",
        operation: "update_automation",
        priority: 95,
      },
    ],
  },
};

const APPROVAL_RULE_TOOLS = [
  "query",
  "get",
  "modify",
  "create",
  "delete",
  "analyze",
  "send",
  "rules",
  "triage",
  "workflow",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizePolicy(value: unknown): ApprovalPolicy | null {
  if (value === "always" || value === "never" || value === "conditional") {
    return value;
  }
  return null;
}

function normalizeConditions(value: unknown): ApprovalRuleConditions | undefined {
  if (!isPlainObject(value)) return undefined;

  const externalOnly =
    typeof value.externalOnly === "boolean" ? value.externalOnly : undefined;
  const domains = Array.isArray(value.domains)
    ? value.domains
        .filter((d): d is string => typeof d === "string")
        .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean)
    : undefined;
  const minItemCount =
    typeof value.minItemCount === "number" && Number.isFinite(value.minItemCount)
      ? Math.max(0, Math.floor(value.minItemCount))
      : undefined;
  const maxItemCount =
    typeof value.maxItemCount === "number" && Number.isFinite(value.maxItemCount)
      ? Math.max(0, Math.floor(value.maxItemCount))
      : undefined;

  const normalized: ApprovalRuleConditions = {};
  if (externalOnly !== undefined) normalized.externalOnly = externalOnly;
  if (domains && domains.length > 0) normalized.domains = domains;
  if (minItemCount !== undefined) normalized.minItemCount = minItemCount;
  if (maxItemCount !== undefined) normalized.maxItemCount = maxItemCount;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeRule(rule: unknown): ApprovalRule | null {
  if (!isPlainObject(rule)) return null;
  const policy = normalizePolicy(rule.policy);
  if (!policy) return null;

  const id =
    typeof rule.id === "string" && rule.id.trim().length > 0
      ? rule.id
      : randomUUID();
  const name =
    typeof rule.name === "string" && rule.name.trim().length > 0
      ? rule.name.trim()
      : `Rule ${id.slice(0, 8)}`;
  const resource =
    typeof rule.resource === "string" && rule.resource.trim().length > 0
      ? rule.resource.trim()
      : undefined;
  const operation =
    typeof rule.operation === "string" && rule.operation.trim().length > 0
      ? rule.operation.trim()
      : undefined;
  const enabled =
    typeof rule.enabled === "boolean" ? rule.enabled : true;
  const disabledUntil =
    typeof rule.disabledUntil === "string" && rule.disabledUntil.trim().length > 0
      ? rule.disabledUntil
      : undefined;
  const createdAt =
    typeof rule.createdAt === "string" && rule.createdAt.trim().length > 0
      ? rule.createdAt
      : undefined;
  const priority =
    typeof rule.priority === "number" && Number.isFinite(rule.priority)
      ? Math.floor(rule.priority)
      : 0;

  return {
    id,
    name,
    policy,
    resource,
    operation,
    enabled,
    disabledUntil,
    createdAt,
    priority,
    conditions: normalizeConditions(rule.conditions),
  };
}

function cloneDefaultConfig(toolName: string): ApprovalRuleConfig {
  const fallback = DEFAULT_TOOL_CONFIG[toolName] ?? {
    version: 2 as const,
    defaultPolicy: "never" as const,
    rules: [],
  };
  return {
    version: 2,
    defaultPolicy: fallback.defaultPolicy,
    defaultConditions: fallback.defaultConditions
      ? { ...fallback.defaultConditions }
      : undefined,
    rules: fallback.rules.map((rule) => ({
      ...rule,
      conditions: rule.conditions ? { ...rule.conditions } : undefined,
    })),
  };
}

function parseStoredConfig(
  toolName: string,
  policy: string | null | undefined,
  rawConditions: unknown,
): ApprovalRuleConfig {
  const defaultConfig = cloneDefaultConfig(toolName);

  if (!isPlainObject(rawConditions)) {
    const normalizedPolicy = normalizePolicy(policy);
    if (normalizedPolicy) {
      defaultConfig.defaultPolicy = normalizedPolicy;
    }
    return defaultConfig;
  }

  // v2 persisted format
  if (rawConditions.version === 2 && Array.isArray(rawConditions.rules)) {
    const defaultPolicy =
      normalizePolicy(rawConditions.defaultPolicy) ??
      normalizePolicy(policy) ??
      defaultConfig.defaultPolicy;
    const rules = rawConditions.rules
      .map(normalizeRule)
      .filter((rule): rule is ApprovalRule => Boolean(rule));

    return {
      version: 2,
      defaultPolicy,
      defaultConditions: normalizeConditions(rawConditions.defaultConditions),
      rules,
    };
  }

  // Legacy format compatibility
  const policyFromRow = normalizePolicy(policy) ?? defaultConfig.defaultPolicy;
  const legacyConditions = normalizeConditions(rawConditions);
  return {
    version: 2,
    defaultPolicy: policyFromRow,
    defaultConditions:
      policyFromRow === "conditional" ? legacyConditions : undefined,
    rules: defaultConfig.rules,
  };
}

function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  const angleMatch = trimmed.match(/<([^>]+)>/);
  const value = (angleMatch?.[1] ?? trimmed).trim();
  if (!value.includes("@")) return null;
  return value;
}

function collectEmailsFromValue(value: unknown, into: Set<string>) {
  if (typeof value === "string") {
    for (const part of value.split(/[;,]/)) {
      const normalized = normalizeEmail(part);
      if (normalized) into.add(normalized);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectEmailsFromValue(item, into);
    }
  }
}

function extractRecipientEmails(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];

  const roots: Array<Record<string, unknown> | undefined> = [
    args,
    isPlainObject(args.data) ? args.data : undefined,
    isPlainObject(args.changes) ? args.changes : undefined,
    isPlainObject(args.options) ? args.options : undefined,
  ];

  const keys = ["to", "cc", "bcc", "recipients", "attendees", "participantEmails"];
  const recipients = new Set<string>();

  for (const root of roots) {
    if (!root) continue;
    for (const key of keys) {
      collectEmailsFromValue(root[key], recipients);
    }
  }

  return Array.from(recipients);
}

function getIdsFromArgs(args: Record<string, unknown> | undefined): string[] {
  if (!args || !Array.isArray(args.ids)) return [];
  return args.ids.filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0,
  );
}

function deriveOperation(
  toolName: string,
  resource: string | undefined,
  args: Record<string, unknown> | undefined,
): string {
  const explicitOperation = normalizeApprovalOperationKey(
    typeof args?.operation === "string" ? args.operation : undefined,
  );
  if (explicitOperation) return explicitOperation;

  const changes = isPlainObject(args?.changes) ? args.changes : undefined;
  const data = isPlainObject(args?.data) ? args.data : undefined;

  if (toolName === "send") return "send_email";

  if (toolName === "delete") {
    if (resource === "email") return "delete_email";
    if (resource === "calendar") return "delete_calendar_event";
    if (resource === "task") return "delete_task";
    if (resource === "automation") return "delete_automation";
    if (resource === "knowledge") return "delete_knowledge";
    return "delete_item";
  }

  if (toolName === "create") {
    if (resource === "email") {
      if (args?.type === "reply") return "create_reply_draft";
      if (args?.type === "forward") return "create_forward_draft";
      return "create_email_draft";
    }
    if (resource === "calendar") {
      if (data?.autoSchedule === true) return "schedule_proposal";
      return "create_calendar_event";
    }
    if (resource === "task") return "create_task";
    if (resource === "automation") return "create_automation";
    if (resource === "knowledge") return "create_knowledge";
    return "create_item";
  }

  if (toolName === "modify") {
    if (resource === "approval") return "approval_decision";
    if (resource === "email") {
      if (changes?.unsubscribe === true) return "unsubscribe_sender";
      if (changes?.bulk_trash_senders) return "bulk_trash_senders";
      if (changes?.bulk_archive_senders) return "bulk_archive_senders";
      if (changes?.bulk_label_senders) return "bulk_label_senders";
      if (changes?.trash === true) return "trash_email";
      if (changes?.restore === true) return "restore_email";
      if (changes?.archive === true) return "archive_email";
      return "update_email";
    }
    if (resource === "calendar") return "update_calendar_event";
    if (resource === "task") return "update_task";
    if (resource === "preferences") {
      return "update_preferences";
    }
    if (resource === "automation") return "update_automation";
    return "modify_item";
  }

  if (toolName === "workflow") return "run_workflow";
  if (toolName === "rules") return "manage_rules";
  if (toolName === "triage") return "triage_tasks";
  if (toolName === "query") return "query";
  if (toolName === "get") return "get";
  if (toolName === "analyze") return "analyze";

  return `${toolName}_operation`;
}

export function deriveApprovalTarget(
  toolName: string,
  args: Record<string, unknown> | undefined,
): ApprovalTarget {
  const resource =
    typeof args?.resource === "string" && args.resource.trim().length > 0
      ? args.resource
      : undefined;
  const ids = getIdsFromArgs(args);
  const fallbackLimit =
    typeof args?.filter === "object" &&
    args?.filter &&
    typeof (args.filter as Record<string, unknown>).limit === "number"
      ? Number((args.filter as Record<string, unknown>).limit)
      : undefined;
  const itemCount = ids.length > 0 ? ids.length : fallbackLimit ?? 0;

  return {
    toolName,
    resource,
    operation: deriveOperation(toolName, resource, args),
    itemCount,
    recipientEmails: extractRecipientEmails(args),
  };
}

function isExternalRecipient(
  recipientEmail: string,
  domains: string[] | undefined,
): boolean {
  if (!domains || domains.length === 0) return true;
  const [, domain = ""] = recipientEmail.split("@");
  const normalizedDomain = domain.trim().toLowerCase();
  if (!normalizedDomain) return true;
  return !domains.includes(normalizedDomain);
}

function matchesRule(rule: ApprovalRule, target: ApprovalTarget): boolean {
  if (rule.enabled === false) {
    if (!rule.disabledUntil) return false;
    const disabledUntil = new Date(rule.disabledUntil);
    if (!Number.isFinite(disabledUntil.getTime())) return false;
    if (disabledUntil.getTime() > Date.now()) return false;
  }
  if (rule.resource && rule.resource !== target.resource) return false;
  if (rule.operation && rule.operation !== target.operation) return false;

  const conditions = rule.conditions;
  if (!conditions) return true;

  if (
    typeof conditions.minItemCount === "number" &&
    target.itemCount < conditions.minItemCount
  ) {
    return false;
  }
  if (
    typeof conditions.maxItemCount === "number" &&
    target.itemCount > conditions.maxItemCount
  ) {
    return false;
  }

  if (conditions.externalOnly) {
    if (target.recipientEmails.length === 0) {
      return true;
    }
    return target.recipientEmails.some((email) =>
      isExternalRecipient(email, conditions.domains),
    );
  }

  return true;
}

function evaluatePolicyWithConditions(
  policy: ApprovalPolicy,
  conditions: ApprovalRuleConditions | undefined,
  target: ApprovalTarget,
): boolean {
  if (policy === "always") return true;
  if (policy === "never") return false;

  // "conditional"
  if (!conditions) return true;
  if (!matchesRule({ id: "default", name: "default", policy, conditions }, target)) {
    return false;
  }
  return true;
}

async function loadRuleConfigForTool(
  userId: string,
  toolName: string,
): Promise<ApprovalRuleConfig> {
  const preferenceRuleName = `approval:${toolName}`;
  const pref = await prisma.canonicalRule.findFirst({
    where: {
      userId,
      type: "preference",
      name: preferenceRuleName,
    },
    select: {
      decision: true,
      preferencePatch: true,
    },
  });

  if (!pref) {
    return cloneDefaultConfig(toolName);
  }

  const parsed = parseStoredConfig(toolName, pref.decision, pref.preferencePatch);
  const now = Date.now();
  let shouldPersist = false;
  const nextRules = parsed.rules.map((rule) => {
    if (!rule.disabledUntil) return rule;
    const until = new Date(rule.disabledUntil);
    if (!Number.isFinite(until.getTime())) {
      shouldPersist = true;
      return { ...rule, disabledUntil: undefined };
    }
    if (until.getTime() <= now && rule.enabled === false) {
      shouldPersist = true;
      return { ...rule, enabled: true, disabledUntil: undefined };
    }
    return rule;
  });

  const normalized = {
    ...parsed,
    rules: nextRules,
  };
  if (shouldPersist) {
    await persistConfig(userId, toolName, normalized);
  }
  return normalized;
}

function sortedRules(rules: ApprovalRule[]): ApprovalRule[] {
  return [...rules].sort((a, b) => {
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    if (priorityA !== priorityB) return priorityB - priorityA;
    const createdAtA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const createdAtB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (createdAtA !== createdAtB) return createdAtB - createdAtA;
    return a.name.localeCompare(b.name);
  });
}

export async function evaluateApprovalRequirement(params: {
  userId: string;
  toolName: string;
  args?: Record<string, unknown>;
}): Promise<ApprovalEvaluation> {
  const { userId, toolName, args } = params;
  const target = deriveApprovalTarget(toolName, args);

  if (target.toolName === "modify" && target.operation === "approval_decision") {
    return {
      requiresApproval: false,
      source: "default",
      target,
    };
  }

  const config = await loadRuleConfigForTool(userId, toolName);
  const matchingRule = sortedRules(config.rules).find((rule) =>
    matchesRule(rule, target),
  );

  if (matchingRule) {
    return {
      requiresApproval: evaluatePolicyWithConditions(
        matchingRule.policy,
        matchingRule.conditions,
        target,
      ),
      matchedRule: matchingRule,
      source: "rule",
      target,
    };
  }

  return {
    requiresApproval: evaluatePolicyWithConditions(
      config.defaultPolicy,
      config.defaultConditions,
      target,
    ),
    source: "default",
    target,
  };
}

function persistConfig(
  userId: string,
  toolName: string,
  config: ApprovalRuleConfig,
) {
  const preferenceRuleName = `approval:${toolName}`;
  const serializedConfig = config as unknown as Prisma.InputJsonValue;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.canonicalRule.findFirst({
      where: {
        userId,
        type: "preference",
        name: preferenceRuleName,
      },
      select: { id: true },
    });

    if (existing) {
      return tx.canonicalRule.update({
        where: { id: existing.id },
        data: {
          enabled: true,
          decision: config.defaultPolicy,
          preferencePatch: serializedConfig,
        },
      });
    }

    return tx.canonicalRule.create({
      data: {
        userId,
        type: "preference",
        name: preferenceRuleName,
        enabled: true,
        sourceMode: "system",
        match: {},
        decision: config.defaultPolicy,
        preferencePatch: serializedConfig,
      },
    });
  });
}

export async function listApprovalRuleConfigs(params: { userId: string }) {
  const userRows = await prisma.canonicalRule.findMany({
    where: {
      userId: params.userId,
      type: "preference",
      name: { startsWith: "approval:" },
    },
    select: { name: true, decision: true, preferencePatch: true },
  });

  const knownTools = new Set<string>(APPROVAL_RULE_TOOLS);
  for (const row of userRows) {
    const toolName = row.name?.replace(/^approval:/, "");
    if (toolName) knownTools.add(toolName);
  }

  const result: Array<{ toolName: string; defaultPolicy: ApprovalPolicy; rules: ApprovalRule[] }> = [];
  for (const toolName of Array.from(knownTools).sort()) {
    const row = userRows.find((item) => item.name === `approval:${toolName}`);
    const config = row
      ? parseStoredConfig(toolName, row.decision, row.preferencePatch)
      : cloneDefaultConfig(toolName);
    result.push({
      toolName,
      defaultPolicy: config.defaultPolicy,
      rules: sortedRules(config.rules),
    });
  }
  return result;
}

export async function upsertApprovalRule(params: {
  userId: string;
  toolName: string;
  rule: {
    id?: string;
    name?: string;
    policy: ApprovalPolicy;
    resource?: string;
    operation?: string;
    enabled?: boolean;
    disabledUntil?: string;
    priority?: number;
    conditions?: ApprovalRuleConditions;
  };
}) {
  const config = await loadRuleConfigForTool(params.userId, params.toolName);
  const ruleId = params.rule.id?.trim() || randomUUID();
  const nextRule: ApprovalRule = {
    id: ruleId,
    name: params.rule.name?.trim() || `Rule ${ruleId.slice(0, 8)}`,
    policy: params.rule.policy,
    resource: params.rule.resource?.trim() || undefined,
    operation: params.rule.operation?.trim() || undefined,
    enabled: params.rule.enabled ?? true,
    disabledUntil:
      typeof params.rule.disabledUntil === "string" &&
      params.rule.disabledUntil.trim().length > 0
        ? params.rule.disabledUntil
        : undefined,
    createdAt: new Date().toISOString(),
    priority: params.rule.priority ?? 0,
    conditions: normalizeConditions(params.rule.conditions),
  };

  const index = config.rules.findIndex((rule) => rule.id === ruleId);
  if (index >= 0) {
    config.rules[index] = {
      ...nextRule,
      createdAt: config.rules[index]?.createdAt ?? nextRule.createdAt,
    };
  } else {
    config.rules.push(nextRule);
  }

  await persistConfig(params.userId, params.toolName, config);
  return {
    toolName: params.toolName,
    rule: nextRule,
    defaultPolicy: config.defaultPolicy,
  };
}

export async function removeApprovalRule(params: {
  userId: string;
  toolName: string;
  ruleId: string;
}) {
  const config = await loadRuleConfigForTool(params.userId, params.toolName);
  const before = config.rules.length;
  config.rules = config.rules.filter((rule) => rule.id !== params.ruleId);
  if (config.rules.length === before) {
    return { removed: false };
  }
  await persistConfig(params.userId, params.toolName, config);
  return { removed: true };
}

export async function setApprovalToolDefaultPolicy(params: {
  userId: string;
  toolName: string;
  defaultPolicy: ApprovalPolicy;
  defaultConditions?: ApprovalRuleConditions;
}) {
  const config = await loadRuleConfigForTool(params.userId, params.toolName);
  config.defaultPolicy = params.defaultPolicy;
  config.defaultConditions =
    params.defaultPolicy === "conditional"
      ? normalizeConditions(params.defaultConditions)
      : undefined;

  await persistConfig(params.userId, params.toolName, config);
  return {
    toolName: params.toolName,
    defaultPolicy: config.defaultPolicy,
    defaultConditions: config.defaultConditions,
  };
}

export async function disableApprovalRule(params: {
  userId: string;
  toolName: string;
  ruleId: string;
  disabledUntil: Date;
}) {
  const config = await loadRuleConfigForTool(params.userId, params.toolName);
  const index = config.rules.findIndex((rule) => rule.id === params.ruleId);
  if (index < 0) return { updated: false };
  config.rules[index] = {
    ...config.rules[index],
    enabled: false,
    disabledUntil: params.disabledUntil.toISOString(),
  };
  await persistConfig(params.userId, params.toolName, config);
  return { updated: true, rule: config.rules[index] };
}

export async function enableApprovalRule(params: {
  userId: string;
  toolName: string;
  ruleId: string;
}) {
  const config = await loadRuleConfigForTool(params.userId, params.toolName);
  const index = config.rules.findIndex((rule) => rule.id === params.ruleId);
  if (index < 0) return { updated: false };
  config.rules[index] = {
    ...config.rules[index],
    enabled: true,
    disabledUntil: undefined,
  };
  await persistConfig(params.userId, params.toolName, config);
  return { updated: true, rule: config.rules[index] };
}

export async function renameApprovalRule(params: {
  userId: string;
  toolName: string;
  ruleId: string;
  name: string;
}) {
  const config = await loadRuleConfigForTool(params.userId, params.toolName);
  const index = config.rules.findIndex((rule) => rule.id === params.ruleId);
  if (index < 0) return { updated: false };
  config.rules[index] = {
    ...config.rules[index],
    name: params.name,
  };
  await persistConfig(params.userId, params.toolName, config);
  return { updated: true, rule: config.rules[index] };
}

export async function findApprovalRuleById(params: {
  userId: string;
  ruleId: string;
}) {
  const configs = await listApprovalRuleConfigs({ userId: params.userId });
  for (const config of configs) {
    const rule = config.rules.find((candidate) => candidate.id === params.ruleId);
    if (rule) {
      return {
        toolName: config.toolName,
        defaultPolicy: config.defaultPolicy,
        rule,
      };
    }
  }
  return null;
}

export async function resolveApprovalRuleReference(params: {
  userId: string;
  reference: {
    id?: string;
    name?: string;
    toolName?: string;
  };
}) {
  const configs = await listApprovalRuleConfigs({ userId: params.userId });
  const allRules = configs.flatMap((config) =>
    config.rules.map((rule) => ({
      toolName: config.toolName,
      rule,
    })),
  );

  if (params.reference.id) {
    const exactById = allRules.find((candidate) => candidate.rule.id === params.reference.id);
    return {
      status: exactById ? ("resolved" as const) : ("none" as const),
      matches: exactById ? [exactById] : [],
    };
  }

  const name = params.reference.name?.trim();
  if (!name) return { status: "none" as const, matches: [] };

  const scoped = params.reference.toolName
    ? allRules.filter((candidate) => candidate.toolName === params.reference.toolName)
    : allRules;
  if (scoped.length === 0) return { status: "none" as const, matches: [] };

  const exact = scoped.filter(
    (candidate) => candidate.rule.name.toLowerCase() === name.toLowerCase(),
  );
  if (exact.length === 1) return { status: "resolved" as const, matches: exact };
  if (exact.length > 1) return { status: "ambiguous" as const, matches: exact.slice(0, 5) };

  const scored = scoped
    .map((candidate) => ({
      ...candidate,
      score: scoreMatch(
        `${candidate.rule.name} ${candidate.toolName} ${candidate.rule.operation ?? ""} ${getApprovalOperationLabel(candidate.rule.operation ?? "")}`,
        name,
      ),
    }))
    .filter((candidate) => candidate.score >= 50)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { status: "none" as const, matches: [] };
  const top = scored[0]?.score ?? 0;
  const topMatches = scored.filter((candidate) => candidate.score >= top - 10).slice(0, 5);
  if (topMatches.length === 1) return { status: "resolved" as const, matches: topMatches };
  return { status: "ambiguous" as const, matches: topMatches };
}

export async function resetApprovalRuleConfig(params: {
  userId: string;
  toolName?: string;
}) {
  if (params.toolName) {
    await prisma.canonicalRule.deleteMany({
      where: {
        userId: params.userId,
        type: "preference",
        name: `approval:${params.toolName}`,
      },
    });
    return;
  }
  await prisma.canonicalRule.deleteMany({
    where: {
      userId: params.userId,
      type: "preference",
      name: { startsWith: "approval:" },
    },
  });
}
