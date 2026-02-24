import { z } from "zod";
import type { Logger } from "@/server/lib/logger";

const baseSchema = z.object({
  userId: z.string().min(1),
  provider: z.string().min(1),
});

export const runtimePlanTelemetrySchema = baseSchema.extend({
  source: z.string().min(1),
  intent: z.enum(["read", "mutate", "mixed", "unknown"]),
  confidence: z.number().min(0).max(1),
  stepCount: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
});

export const runtimeRouteSelectedTelemetrySchema = baseSchema.extend({
  lane: z.enum(["conversation_only", "evidence_first", "planner"]),
  profile: z.enum(["fast", "standard", "deep"]),
  reason: z.string().min(1).max(120),
  nativeMaxSteps: z.number().int().nonnegative(),
  nativeTurnTimeoutMs: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  decisionTimeoutMs: z.number().int().nonnegative(),
  toolCatalogLimit: z.number().int().nonnegative(),
  includeSkillGuidance: z.boolean(),
});

export const runtimeToolLifecycleTelemetrySchema = baseSchema.extend({
  phase: z.enum(["start", "update", "result"]),
  toolName: z.string().min(1).max(120),
  toolCallId: z.string().min(1).max(160),
  stepIndex: z.number().int().nonnegative(),
  outcome: z.enum(["success", "blocked", "failed", "unknown"]).optional(),
});

export const runtimeDirectReadTelemetrySchema = baseSchema.extend({
  toolName: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const runtimeTurnCompletedTelemetrySchema = baseSchema.extend({
  durationMs: z.number().int().nonnegative(),
  stepCount: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  approvalsCount: z.number().int().nonnegative(),
  interactivePayloadsCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  turnCostUsd: z.number().nonnegative().optional(),
  stopReason: z.enum([
    "completed",
    "needs_clarification",
    "approval_pending",
    "runtime_error",
    "max_attempts",
  ]),
  failureReason: z.string().min(1).max(160).optional(),
});

export const runtimeEmailSearchSuccessMetricSchema = baseSchema.extend({
  attempts: z.number().int().positive(),
  successes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
});

export const runtimeTaskRescheduleSuccessMetricSchema = baseSchema.extend({
  attempts: z.number().int().positive(),
  successes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
});

export const runtimeToolFailureRateByToolMetricSchema = baseSchema.extend({
  toolName: z.string().min(1).max(120),
  totalCalls: z.number().int().positive(),
  failedCalls: z.number().int().nonnegative(),
  failureRate: z.number().min(0).max(1),
});

export const runtimeTurnCostUsdMetricSchema = baseSchema.extend({
  turnCostUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export const runtimePrecheckFailedTelemetrySchema = baseSchema.extend({
  issues: z.array(z.string().min(1)).min(1).max(16),
});

export const runtimeClarificationRequiredTelemetrySchema = baseSchema.extend({
  prompt: z.string().min(1).max(320),
  confidence: z.number().min(0).max(1),
});

export const runtimeContextHydratedTelemetrySchema = baseSchema.extend({
  status: z.enum(["ready", "degraded", "missing"]),
  tier: z.enum(["bootstrap", "targeted", "expanded"]).optional(),
  issues: z.array(z.string().min(1)).max(16).default([]),
  facts: z.number().int().nonnegative(),
  knowledge: z.number().int().nonnegative(),
  history: z.number().int().nonnegative(),
  attentionItems: z.number().int().nonnegative(),
  hasSummary: z.boolean(),
  hasPendingState: z.boolean(),
});

export const runtimeContextPrunedTelemetrySchema = baseSchema.extend({
  lane: z.enum(["conversation_only", "evidence_first", "planner"]),
  mode: z.enum(["soft", "hard"]),
  beforeChars: z.number().int().nonnegative(),
  afterChars: z.number().int().nonnegative(),
  removedCount: z.number().int().nonnegative(),
  truncatedCount: z.number().int().nonnegative(),
});

export const runtimeCompactionRetryTelemetrySchema = baseSchema.extend({
  lane: z.enum(["conversation_only", "evidence_first", "planner"]),
  overflowDetected: z.boolean(),
  retryAttempted: z.boolean(),
  retrySucceeded: z.boolean(),
  beforeChars: z.number().int().nonnegative(),
  afterChars: z.number().int().nonnegative().optional(),
  memoryFlushQueued: z.boolean().optional(),
});

export const runtimeContextSlotsTelemetrySchema = baseSchema.extend({
  lane: z.enum(["conversation_only", "evidence_first", "planner"]),
  maxChars: z.number().int().positive(),
  maxFacts: z.number().int().positive(),
  maxKnowledge: z.number().int().positive(),
  maxHistory: z.number().int().positive(),
});

const runtimeTelemetrySchemas = {
  "openworld.runtime.plan": runtimePlanTelemetrySchema,
  "openworld.runtime.route_selected": runtimeRouteSelectedTelemetrySchema,
  "openworld.runtime.direct_read": runtimeDirectReadTelemetrySchema,
  "openworld.runtime.tool_lifecycle": runtimeToolLifecycleTelemetrySchema,
  "openworld.runtime.context_hydrated": runtimeContextHydratedTelemetrySchema,
  "openworld.runtime.context_pruned": runtimeContextPrunedTelemetrySchema,
  "openworld.runtime.compaction_retry": runtimeCompactionRetryTelemetrySchema,
  "openworld.runtime.context_slots": runtimeContextSlotsTelemetrySchema,
  "openworld.metric.email_search_success_rate": runtimeEmailSearchSuccessMetricSchema,
  "openworld.metric.task_reschedule_success_rate":
    runtimeTaskRescheduleSuccessMetricSchema,
  "openworld.metric.tool_call_failure_rate_by_tool":
    runtimeToolFailureRateByToolMetricSchema,
  "openworld.metric.turn_cost_usd": runtimeTurnCostUsdMetricSchema,
  "openworld.turn.completed": runtimeTurnCompletedTelemetrySchema,
  "openworld.runtime.precheck_failed": runtimePrecheckFailedTelemetrySchema,
  "openworld.runtime.clarification_required":
    runtimeClarificationRequiredTelemetrySchema,
} as const;

export type RuntimeTelemetryEventName = keyof typeof runtimeTelemetrySchemas;
type RuntimeTelemetryPayload<T extends RuntimeTelemetryEventName> = z.infer<
  (typeof runtimeTelemetrySchemas)[T]
>;

export function emitRuntimeTelemetry<T extends RuntimeTelemetryEventName>(
  logger: Logger,
  event: T,
  payload: RuntimeTelemetryPayload<T>,
) {
  const parsed = runtimeTelemetrySchemas[event].safeParse(payload);
  if (!parsed.success) {
    logger.warn("openworld.runtime.telemetry.invalid", {
      event,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }
  logger.info(event, parsed.data);
}
