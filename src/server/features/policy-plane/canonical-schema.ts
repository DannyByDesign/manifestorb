import { z } from "zod";

export const canonicalRuleTypeSchema = z.enum([
  "guardrail",
  "automation",
  "preference",
]);

export const canonicalDecisionSchema = z.enum([
  "allow",
  "block",
  "require_approval",
  "allow_with_transform",
]);

export const canonicalSourceModeSchema = z.enum([
  "ui",
  "ai_nl",
  "migration",
  "system",
]);

export const canonicalConditionSchema = z
  .object({
    field: z.string().min(1),
    op: z.enum([
      "eq",
      "neq",
      "in",
      "not_in",
      "contains",
      "regex",
      "gt",
      "gte",
      "lt",
      "lte",
      "exists",
    ]),
    value: z.unknown().optional(),
  })
  .strict();

export const canonicalMatchSchema = z
  .object({
    resource: z.enum(["email", "calendar", "task", "rule", "preference", "workflow"]),
    operation: z.string().min(1).optional(),
    conditions: z.array(canonicalConditionSchema).default([]),
  })
  .strict();

export const canonicalTriggerSchema = z
  .union([
    z
      .object({
        kind: z.literal("event"),
        eventType: z.string().min(1),
        debounceSeconds: z.number().int().min(0).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("schedule"),
        cron: z.string().min(1),
        timeZone: z.string().min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("manual"),
        entrypoint: z.enum(["chat", "ui", "api"]),
      })
      .strict(),
  ])
  .optional();

export const canonicalRuleSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().min(1),
    type: canonicalRuleTypeSchema,
    enabled: z.boolean(),
    priority: z.number().int(),
    name: z.string().optional(),
    description: z.string().optional(),
    scope: z
      .object({
        surfaces: z.array(z.enum(["web", "slack", "discord", "telegram", "system"])).default([]),
        resources: z
          .array(z.enum(["email", "calendar", "task", "rule", "preference", "workflow"]))
          .default([]),
      })
      .strict()
      .optional(),
    trigger: canonicalTriggerSchema,
    match: canonicalMatchSchema,
    decision: canonicalDecisionSchema.optional(),
    transform: z
      .object({
        patch: z
          .array(
            z
              .object({
                path: z.string().min(1),
                value: z.unknown(),
              })
              .strict(),
          )
          .default([]),
        reason: z.string().min(1),
      })
      .strict()
      .optional(),
    actionPlan: z
      .object({
        actions: z
          .array(
            z
              .object({
                actionType: z.string().min(1),
                args: z.record(z.string(), z.unknown()).default({}),
                idempotencyScope: z.enum(["event", "thread", "message", "user"]).optional(),
              })
              .strict(),
          )
          .default([]),
      })
      .strict()
      .optional(),
    preferencePatch: z
      .object({
        updates: z
          .array(
            z
              .object({
                key: z.string().min(1),
                value: z.unknown(),
              })
              .strict(),
          )
          .default([]),
      })
      .strict()
      .optional(),
    source: z
      .object({
        mode: canonicalSourceModeSchema,
        sourceNl: z.string().optional(),
        sourceMessageId: z.string().optional(),
        sourceConversationId: z.string().optional(),
        compilerVersion: z.string().optional(),
        compilerConfidence: z.number().min(0).max(1).optional(),
        compilerWarnings: z.array(z.string()).optional(),
      })
      .strict(),
    expiresAt: z.string().optional(),
    disabledUntil: z.string().optional(),
    legacyRefType: z.string().optional(),
    legacyRefId: z.string().optional(),
  })
  .strict();

export type CanonicalRule = z.infer<typeof canonicalRuleSchema>;
export type CanonicalRuleType = z.infer<typeof canonicalRuleTypeSchema>;
export type CanonicalDecision = z.infer<typeof canonicalDecisionSchema>;

export type CanonicalRuleCreateInput = Omit<CanonicalRule, "id" | "version"> & {
  id?: string;
  version?: number;
};

export function normalizeCanonicalRuleCreateInput(
  input: CanonicalRuleCreateInput,
): CanonicalRuleCreateInput {
  return {
    ...input,
    priority: Number.isFinite(input.priority) ? Math.trunc(input.priority) : 0,
    enabled: input.enabled ?? true,
    source: {
      mode: input.source.mode ?? "system",
      sourceNl: input.source.sourceNl,
      sourceMessageId: input.source.sourceMessageId,
      sourceConversationId: input.source.sourceConversationId,
      compilerVersion: input.source.compilerVersion,
      compilerConfidence: input.source.compilerConfidence,
      compilerWarnings: input.source.compilerWarnings,
    },
  };
}

export function isRuleActiveNow(params: {
  enabled: boolean;
  expiresAt?: string | null;
  disabledUntil?: string | null;
  now?: Date;
}): boolean {
  if (!params.enabled) return false;
  const now = params.now ?? new Date();
  if (params.expiresAt) {
    const expires = new Date(params.expiresAt);
    if (!Number.isNaN(expires.getTime()) && expires <= now) return false;
  }
  if (params.disabledUntil) {
    const disabledUntil = new Date(params.disabledUntil);
    if (!Number.isNaN(disabledUntil.getTime()) && disabledUntil > now) return false;
  }
  return true;
}
