import { ActionType } from "@/generated/prisma/enums";
import type { CanonicalRuleCreateInput } from "@/server/features/policy-plane/canonical-schema";
import { createRulePlaneRule } from "@/server/features/policy-plane/service";
import prisma from "@/server/db/client";

type LegacyActionInput = {
  type?: string;
  [key: string]: unknown;
};

type LegacyRuleInput = {
  name?: string;
  description?: string;
  actions?: LegacyActionInput[];
  canonical?: CanonicalRuleCreateInput;
};

function toCanonicalRule(params: {
  input: LegacyRuleInput;
  sourceText?: string;
}): CanonicalRuleCreateInput {
  if (params.input.canonical) {
    return {
      ...params.input.canonical,
      ...(params.input.name ? { name: params.input.name } : {}),
      trigger:
        params.input.canonical.trigger ??
        ({
          kind: "event",
          eventType: "email.received",
        } as const),
      match: {
        ...params.input.canonical.match,
        operation: params.input.canonical.match.operation ?? "inbound_received",
      },
    };
  }

  const actions = (params.input.actions ?? [])
    .map((action) => {
      const actionType = typeof action.type === "string" ? action.type : "";
      if (!actionType) return null;
      const { type: _omit, ...rest } = action;
      return {
        actionType,
        args: rest,
        idempotencyScope: "thread" as const,
      };
    })
    .filter((action): action is NonNullable<typeof action> => Boolean(action));

  return {
    type: "automation",
    enabled: true,
    priority: 0,
    name: params.input.name ?? "Compatibility rule",
    description:
      params.input.description ??
      "Created from legacy rules API compatibility wrapper.",
    scope: {
      surfaces: ["web", "slack", "discord", "telegram", "system"],
      resources: ["email"],
    },
    trigger: {
      kind: "event",
      eventType: "email.received",
    },
    match: {
      resource: "email",
      operation: "inbound_received",
      conditions: [],
    },
    actionPlan: {
      actions:
        actions.length > 0
          ? actions
          : [
              {
                actionType: ActionType.NOTIFY_USER,
                args: {},
                idempotencyScope: "thread",
              },
            ],
    },
    source: {
      mode: "migration",
      sourceNl: params.sourceText,
      compilerVersion: "compat-v1",
      compilerConfidence: 1,
      compilerWarnings: ["Created through legacy rules compatibility wrapper."],
    },
  };
}

export async function createRule(params: {
  result: LegacyRuleInput;
  emailAccountId: string;
  provider?: string;
  runOnThreads?: boolean;
  logger?: unknown;
}) {
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: params.emailAccountId },
    select: { userId: true },
  });
  if (!emailAccount) {
    throw new Error(`Email account not found for id=${params.emailAccountId}`);
  }

  const rule = await createRulePlaneRule({
    userId: emailAccount.userId,
    emailAccountId: params.emailAccountId,
    rule: toCanonicalRule({
      input: params.result,
      sourceText: params.result.name,
    }),
  });

  return {
    id: rule.id,
    canonicalRuleId: rule.id,
  };
}
