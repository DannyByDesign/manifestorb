import {
  evaluateApprovalRequirement,
  type ApprovalEvaluation,
} from "@/server/features/approvals/rules";
import type { CanonicalRule } from "@/server/features/policy-plane/canonical-schema";
import { isRuleActiveNow } from "@/server/features/policy-plane/canonical-schema";
import { listEffectiveCanonicalRules } from "@/server/features/policy-plane/repository";
import { createPolicyDecisionLog } from "@/server/features/policy-plane/policy-logs";

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
  emailAccountId?: string;
  toolName: string;
  args: Record<string, unknown>;
  rawArgs?: Record<string, unknown>;
  context: {
    source:
      | "skills"
      | "runtime"
      | "planner"
      | "automation"
      | "scheduled"
      | "calendar_replanner"
      | "task_scheduler";
    provider?: "web" | "slack" | "discord" | "telegram" | "system";
    conversationId?: string;
    channelId?: string;
    threadId?: string;
    messageId?: string;
    correlationId?: string;
  };
};

type EvaluationContext = {
  source: PolicyIntent["context"]["source"];
  provider: "web" | "slack" | "discord" | "telegram" | "system";
  mutation: {
    resource: string;
    operation: string;
    args: Record<string, unknown>;
    itemCount: number;
    recipientDomains: string[];
  };
};

function getByPath(value: unknown, path: string): unknown {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  let current: unknown = value;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function toDomains(values: unknown): string[] {
  const emails = Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string")
    : typeof values === "string"
      ? [values]
      : [];
  return emails
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
    .map((email) => {
      const at = email.lastIndexOf("@");
      return at >= 0 ? email.slice(at + 1) : email;
    })
    .filter(Boolean);
}

function inferResource(toolName: string, args: Record<string, unknown>): string {
  if (typeof args.resource === "string" && args.resource.trim()) {
    return args.resource.trim().toLowerCase();
  }
  if (typeof args.operation === "string") {
    const op = args.operation.toLowerCase();
    if (op.includes("calendar")) return "calendar";
    if (op.includes("task")) return "task";
    if (op.includes("rule") || op.includes("automation")) return "rule";
    if (op.includes("preference")) return "preference";
  }
  if (toolName === "create" || toolName === "modify" || toolName === "delete" || toolName === "send") {
    return "email";
  }
  return "workflow";
}

function inferOperation(toolName: string, args: Record<string, unknown>): string {
  if (typeof args.operation === "string" && args.operation.trim()) {
    return args.operation.trim().toLowerCase();
  }
  const explicit = typeof args.actionType === "string" ? args.actionType : null;
  if (explicit) return explicit.toLowerCase();
  switch (toolName) {
    case "query":
    case "get":
    case "analyze":
      return "query";
    case "send":
      return "send_email";
    case "delete":
      return "delete";
    case "create":
      return "create";
    case "modify":
      return "modify";
    default:
      return toolName;
  }
}

function inferItemCount(args: Record<string, unknown>): number {
  if (Array.isArray(args.ids)) return args.ids.length;
  if (typeof args.itemCount === "number" && Number.isFinite(args.itemCount)) {
    return Math.max(0, Math.trunc(args.itemCount));
  }
  return 1;
}

function buildEvaluationContext(intent: PolicyIntent): EvaluationContext {
  const provider = intent.context.provider ?? "system";
  const operation = inferOperation(intent.toolName, intent.args);
  const resource = inferResource(intent.toolName, intent.args);
  return {
    source: intent.context.source,
    provider,
    mutation: {
      resource,
      operation,
      args: intent.args,
      itemCount: inferItemCount(intent.args),
      recipientDomains: toDomains(intent.args.to),
    },
  };
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

function matchesRule(rule: CanonicalRule, context: EvaluationContext): boolean {
  if (!isRuleActiveNow(rule)) return false;
  if (rule.scope?.surfaces && rule.scope.surfaces.length > 0) {
    if (!rule.scope.surfaces.includes(context.provider)) return false;
  }
  if (rule.scope?.resources && rule.scope.resources.length > 0) {
    if (!rule.scope.resources.includes(context.mutation.resource as never)) return false;
  }
  if (rule.match.resource !== (context.mutation.resource as never)) return false;
  if (!operationMatches(rule.match.operation, context.mutation.operation)) {
    return false;
  }

  const conditionContext = {
    mutation: context.mutation,
    target: {
      resource: context.mutation.resource,
      operation: context.mutation.operation,
      itemCount: context.mutation.itemCount,
    },
    actor: {
      recipient: {
        domain: context.mutation.recipientDomains,
        externalOnly: context.mutation.recipientDomains.length > 0,
      },
    },
    context: {
      source: context.source,
      provider: context.provider,
    },
  };
  return rule.match.conditions.every((condition) =>
    compareCondition({
      op: condition.op,
      actual: getByPath(conditionContext, condition.field),
      expected: condition.value,
    }),
  );
}

function operationMatches(
  ruleOperation: string | undefined,
  actualOperation: string,
): boolean {
  if (!ruleOperation || ruleOperation.trim().length === 0) return true;
  const expected = ruleOperation.trim().toLowerCase();
  const actual = actualOperation.trim().toLowerCase();
  if (expected === actual) return true;

  // Backward-compatible aliases used by migrated preference rules.
  if (expected === "create_or_reschedule") {
    return (
      actual === "create_calendar_event" ||
      actual === "update_calendar_event" ||
      actual === "reschedule_event" ||
      actual === "create" ||
      actual === "modify"
    );
  }
  if (expected === "planner_execution") {
    return actual.startsWith("planner_") || actual === "analyze";
  }
  if (expected.includes(",") || expected.includes("|")) {
    const normalized = expected.replaceAll("|", ",");
    return normalized
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean)
      .includes(actual);
  }
  if (expected.endsWith("*")) {
    return actual.startsWith(expected.slice(0, -1));
  }
  return false;
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return;
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i]!;
    const next = cursor[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]!] = value;
}

function applyTransformPatch(params: {
  input: Record<string, unknown>;
  patch: Array<{ path: string; value: unknown }>;
}): Record<string, unknown> {
  const cloned = structuredClone(params.input);
  for (const item of params.patch) {
    setByPath(cloned, item.path, item.value);
  }
  return cloned;
}

function applyPreferencePatch(params: {
  input: Record<string, unknown>;
  rule: CanonicalRule;
  context: EvaluationContext;
}): Record<string, unknown> | null {
  if (
    !params.rule.preferencePatch?.updates ||
    params.rule.preferencePatch.updates.length === 0
  ) {
    return null;
  }
  const next = structuredClone(params.input);
  let changed = false;
  for (const update of params.rule.preferencePatch.updates) {
    const key = update.key;
    if (key === "calendar.defaultMeetingDurationMin") {
      if (
        params.context.mutation.resource === "calendar" &&
        params.context.mutation.operation === "create_calendar_event" &&
        next.durationMinutes === undefined &&
        next.end === undefined
      ) {
        next.durationMinutes = update.value;
        changed = true;
      }
      continue;
    }
    if (key === "calendar.timeZone") {
      if (params.context.mutation.resource === "calendar" && next.timeZone === undefined) {
        next.timeZone = update.value;
        changed = true;
      }
      continue;
    }
    if (
      key === "calendar.workingHours.start" ||
      key === "calendar.workingHours.end" ||
      key === "calendar.workingHours.days" ||
      key === "calendar.bufferMinutes"
    ) {
      if (next.policyContext === undefined) {
        next.policyContext = {};
      }
      const policyContext = next.policyContext as Record<string, unknown>;
      const shortKey = key.replace("calendar.", "");
      if (policyContext[shortKey] === undefined) {
        policyContext[shortKey] = update.value;
        changed = true;
      }
      continue;
    }
    if (key.startsWith("args.")) {
      setByPath(next, key.slice("args.".length), update.value);
      changed = true;
      continue;
    }
    if (next[key] === undefined) {
      next[key] = update.value;
      changed = true;
    }
  }
  return changed ? next : null;
}

async function logDecision(params: {
  intent: PolicyIntent;
  context: EvaluationContext;
  decision: PolicyDecision;
  canonicalRuleId?: string;
}) {
  try {
    await createPolicyDecisionLog({
      userId: params.intent.userId,
      emailAccountId: params.intent.emailAccountId,
      canonicalRuleId: params.canonicalRuleId,
      source: params.intent.context.source,
      toolName: params.intent.toolName,
      mutationResource: params.context.mutation.resource,
      mutationOperation: params.context.mutation.operation,
      args: params.intent.args,
      decisionKind: params.decision.kind,
      reasonCode: params.decision.reasonCode,
      message: params.decision.message,
      requiresApproval: params.decision.kind === "require_approval",
      approvalPayload: params.decision.approval?.matchedRule
        ? { matchedRule: params.decision.approval.matchedRule }
        : undefined,
      transformedArgs: params.decision.transformedArgs,
      correlationId: params.intent.context.correlationId,
      conversationId: params.intent.context.conversationId,
      channelId: params.intent.context.channelId,
      threadId: params.intent.context.threadId,
      messageId: params.intent.context.messageId,
    });
  } catch {
    // Policy logging must never block policy enforcement.
  }
}

/**
 * Unified policy decision point (PDP).
 * Current implementation uses the approval rules engine as the first canonical
 * decision source; later phases add block/transform canonical rule evaluation.
 */
export async function evaluatePolicyDecision(
  intent: PolicyIntent,
): Promise<PolicyDecision> {
  const evaluation = buildEvaluationContext(intent);
  const evaluationArgs = intent.rawArgs ?? intent.args;

  const canonicalRules = await listEffectiveCanonicalRules({
    userId: intent.userId,
    emailAccountId: intent.emailAccountId,
  });

  const guardrails = canonicalRules.filter(
    (rule) => rule.type === "guardrail" && matchesRule(rule, evaluation),
  );
  const topGuardrail = guardrails[0];

  if (topGuardrail?.decision === "block") {
    const blocked: PolicyDecision = {
      kind: "block",
      reasonCode: "policy_blocked",
      message:
        topGuardrail.description ||
        topGuardrail.name ||
        "Action blocked by policy.",
    };
    await logDecision({
      intent,
      context: evaluation,
      decision: blocked,
      canonicalRuleId: topGuardrail.id,
    });
    return blocked;
  }

  if (topGuardrail?.decision === "allow_with_transform" && topGuardrail.transform?.patch) {
    const transformed = applyTransformPatch({
      input: evaluationArgs,
      patch: topGuardrail.transform.patch,
    });
    const transformedDecision: PolicyDecision = {
      kind: "allow_with_transform",
      reasonCode: "policy_transform_applied",
      message:
        topGuardrail.transform.reason ||
        topGuardrail.description ||
        "Applied policy transform.",
      transformedArgs: transformed,
    };
    await logDecision({
      intent,
      context: evaluation,
      decision: transformedDecision,
      canonicalRuleId: topGuardrail.id,
    });
    return transformedDecision;
  }

  if (topGuardrail?.decision === "require_approval") {
    const approval = await evaluateApprovalRequirement({
      userId: intent.userId,
      toolName: intent.toolName,
      args: intent.args,
    });
    const needsApproval = approval.requiresApproval || Boolean(topGuardrail);
    if (needsApproval) {
      const decision: PolicyDecision = {
        kind: "require_approval",
        reasonCode: "approval_required",
        message:
          topGuardrail.description ||
          topGuardrail.name ||
          "Action requires approval before execution.",
        approval: {
          ...approval,
          requiresApproval: true,
        },
      };
      await logDecision({
        intent,
        context: evaluation,
        decision,
        canonicalRuleId: topGuardrail.id,
      });
      return decision;
    }
  }

  // Apply preference transforms when available (non-blocking).
  const preferenceRules = canonicalRules.filter(
    (rule) => rule.type === "preference" && matchesRule(rule, evaluation),
  );
  for (const rule of preferenceRules) {
    const transformed = applyPreferencePatch({
      input: evaluationArgs,
      rule,
      context: evaluation,
    });
    if (!transformed) continue;
    const decision: PolicyDecision = {
      kind: "allow_with_transform",
      reasonCode: "preference_transform_applied",
      message: rule.name || "Applied preference constraints.",
      transformedArgs: transformed,
    };
    await logDecision({
      intent,
      context: evaluation,
      decision,
      canonicalRuleId: rule.id,
    });
    return decision;
  }

  // Backward-compatible approval fallback for default policies and unmigrated paths.
  const approval = await evaluateApprovalRequirement({
    userId: intent.userId,
    toolName: intent.toolName,
    args: intent.args,
  });

  if (approval.requiresApproval) {
    const decision: PolicyDecision = {
      kind: "require_approval",
      reasonCode: "approval_required",
      message: "Action requires approval before execution.",
      approval,
    };
    await logDecision({
      intent,
      context: evaluation,
      decision,
    });
    return decision;
  }

  const decision: PolicyDecision = {
    kind: "allow",
    reasonCode: "allowed",
    message: "Action allowed by current policy.",
    approval,
  };
  await logDecision({
    intent,
    context: evaluation,
    decision,
    canonicalRuleId: topGuardrail?.id,
  });
  return decision;
}
