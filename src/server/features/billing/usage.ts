import { Prisma } from "@/generated/prisma/client";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("billing/usage");

const STARTER_DEFAULTS = {
  planCode: "starter_10_usd",
  monthlyCostSoftUsd: 2.8,
  monthlyCostHardUsd: 3.25,
  monthlyProactiveRunLimit: 600,
  monthlyRuntimeTurnLimit: 3000,
};

function isMissingTableError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return code === "P2021";
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value instanceof Prisma.Decimal) return value.toNumber();
  return 0;
}

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(Number.isFinite(value) ? value : 0);
}

function toJsonValue(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function currentMonthBucket(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export interface RuntimeLimitDecision {
  allowed: boolean;
  reason?: "cost_hard_cap" | "runtime_turn_cap" | "token_cap";
  softCapExceeded: boolean;
  hardCostCapUsd: number;
  currentCostUsd: number;
  monthlyRuntimeTurns: number;
}

export interface ProactiveLimitDecision {
  allowed: boolean;
  reason?: "cost_hard_cap" | "proactive_run_cap";
  monthlyProactiveRuns: number;
  proactiveRunCap: number;
}

async function ensureUserLimit(userId: string) {
  try {
    return await prisma.userLimit.upsert({
      where: { userId },
      create: {
        userId,
        planCode: STARTER_DEFAULTS.planCode,
        monthlyCostSoftUsd: STARTER_DEFAULTS.monthlyCostSoftUsd,
        monthlyCostHardUsd: STARTER_DEFAULTS.monthlyCostHardUsd,
        monthlyProactiveRunLimit: STARTER_DEFAULTS.monthlyProactiveRunLimit,
        monthlyRuntimeTurnLimit: STARTER_DEFAULTS.monthlyRuntimeTurnLimit,
        enforcementMode: "enforce_hard_cap",
      },
      update: {},
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      return {
        userId,
        planCode: STARTER_DEFAULTS.planCode,
        monthlyCostSoftUsd: toDecimal(STARTER_DEFAULTS.monthlyCostSoftUsd),
        monthlyCostHardUsd: toDecimal(STARTER_DEFAULTS.monthlyCostHardUsd),
        monthlyInputTokenLimit: null,
        monthlyOutputTokenLimit: null,
        monthlyTotalTokenLimit: null,
        monthlyProactiveRunLimit: STARTER_DEFAULTS.monthlyProactiveRunLimit,
        monthlyRuntimeTurnLimit: STARTER_DEFAULTS.monthlyRuntimeTurnLimit,
        enforcementMode: "enforce_hard_cap",
      };
    }
    throw error;
  }
}

async function readMonthlyUsage(userId: string, monthBucket: Date) {
  try {
    return await prisma.userMonthlyUsage.findUnique({
      where: {
        userId_monthBucket: {
          userId,
          monthBucket,
        },
      },
    });
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
}

export async function canRunRuntimeTurn(userId: string): Promise<RuntimeLimitDecision> {
  try {
    const monthBucket = currentMonthBucket();
    const [limit, usage] = await Promise.all([
      ensureUserLimit(userId),
      readMonthlyUsage(userId, monthBucket),
    ]);

    const hardCostCapUsd = asNumber(limit.monthlyCostHardUsd);
    const softCostCapUsd = asNumber(limit.monthlyCostSoftUsd);
    const currentCostUsd = asNumber(usage?.estimatedCostUsd);
    const monthlyRuntimeTurns = usage?.runtimeTurns ?? 0;

    if (currentCostUsd >= hardCostCapUsd) {
      return {
        allowed: false,
        reason: "cost_hard_cap",
        softCapExceeded: currentCostUsd >= softCostCapUsd,
        hardCostCapUsd,
        currentCostUsd,
        monthlyRuntimeTurns,
      };
    }

    if (
      typeof limit.monthlyRuntimeTurnLimit === "number" &&
      monthlyRuntimeTurns >= limit.monthlyRuntimeTurnLimit
    ) {
      return {
        allowed: false,
        reason: "runtime_turn_cap",
        softCapExceeded: currentCostUsd >= softCostCapUsd,
        hardCostCapUsd,
        currentCostUsd,
        monthlyRuntimeTurns,
      };
    }

    if (
      typeof limit.monthlyTotalTokenLimit === "number" &&
      (usage?.totalTokens ?? 0) >= limit.monthlyTotalTokenLimit
    ) {
      return {
        allowed: false,
        reason: "token_cap",
        softCapExceeded: currentCostUsd >= softCostCapUsd,
        hardCostCapUsd,
        currentCostUsd,
        monthlyRuntimeTurns,
      };
    }

    return {
      allowed: true,
      softCapExceeded: currentCostUsd >= softCostCapUsd,
      hardCostCapUsd,
      currentCostUsd,
      monthlyRuntimeTurns,
    };
  } catch (error) {
    logger.warn("Failed to evaluate runtime limits; allowing turn", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      allowed: true,
      softCapExceeded: false,
      hardCostCapUsd: STARTER_DEFAULTS.monthlyCostHardUsd,
      currentCostUsd: 0,
      monthlyRuntimeTurns: 0,
    };
  }
}

export async function recordRuntimeUsage(params: {
  userId: string;
  conversationId?: string;
  provider?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  direction?: "runtime_turn" | "proactive_job";
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const monthBucket = currentMonthBucket();
  const estimatedCost = params.estimatedCostUsd ?? 0;
  const direction = params.direction ?? "runtime_turn";

  try {
    await prisma.$transaction(async (tx) => {
      await tx.usageLedger.create({
        data: {
          userId: params.userId,
          conversationId: params.conversationId,
          provider: params.provider,
          model: params.model,
          direction,
          inputTokens: Math.max(0, Math.trunc(params.inputTokens)),
          outputTokens: Math.max(0, Math.trunc(params.outputTokens)),
          totalTokens: Math.max(0, Math.trunc(params.totalTokens)),
          estimatedCostUsd: toDecimal(estimatedCost),
          monthBucket,
          metadata: toJsonValue(params.metadata),
        },
      });

      await tx.userMonthlyUsage.upsert({
        where: {
          userId_monthBucket: {
            userId: params.userId,
            monthBucket,
          },
        },
        create: {
          userId: params.userId,
          monthBucket,
          inputTokens: Math.max(0, Math.trunc(params.inputTokens)),
          outputTokens: Math.max(0, Math.trunc(params.outputTokens)),
          totalTokens: Math.max(0, Math.trunc(params.totalTokens)),
          estimatedCostUsd: toDecimal(estimatedCost),
          runtimeTurns: direction === "runtime_turn" ? 1 : 0,
          proactiveRuns: direction === "proactive_job" ? 1 : 0,
        },
        update: {
          inputTokens: { increment: Math.max(0, Math.trunc(params.inputTokens)) },
          outputTokens: { increment: Math.max(0, Math.trunc(params.outputTokens)) },
          totalTokens: { increment: Math.max(0, Math.trunc(params.totalTokens)) },
          estimatedCostUsd: { increment: toDecimal(estimatedCost) },
          runtimeTurns: { increment: direction === "runtime_turn" ? 1 : 0 },
          proactiveRuns: { increment: direction === "proactive_job" ? 1 : 0 },
        },
      });
    });
  } catch (error) {
    if (isMissingTableError(error)) return;
    logger.warn("Failed to persist usage ledger", {
      userId: params.userId,
      direction,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function canRunProactiveAttention(userId: string): Promise<ProactiveLimitDecision> {
  try {
    const monthBucket = currentMonthBucket();
    const [limit, usage] = await Promise.all([
      ensureUserLimit(userId),
      readMonthlyUsage(userId, monthBucket),
    ]);

    const hardCostCapUsd = asNumber(limit.monthlyCostHardUsd);
    const currentCostUsd = asNumber(usage?.estimatedCostUsd);
    const monthlyProactiveRuns = usage?.proactiveRuns ?? 0;

    if (currentCostUsd >= hardCostCapUsd) {
      return {
        allowed: false,
        reason: "cost_hard_cap",
        monthlyProactiveRuns,
        proactiveRunCap: limit.monthlyProactiveRunLimit,
      };
    }

    if (monthlyProactiveRuns >= limit.monthlyProactiveRunLimit) {
      return {
        allowed: false,
        reason: "proactive_run_cap",
        monthlyProactiveRuns,
        proactiveRunCap: limit.monthlyProactiveRunLimit,
      };
    }

    return {
      allowed: true,
      monthlyProactiveRuns,
      proactiveRunCap: limit.monthlyProactiveRunLimit,
    };
  } catch (error) {
    logger.warn("Failed to evaluate proactive limits; allowing run", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      allowed: true,
      monthlyProactiveRuns: 0,
      proactiveRunCap: STARTER_DEFAULTS.monthlyProactiveRunLimit,
    };
  }
}

export async function recordProactiveAttentionRun(params: {
  userId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await recordRuntimeUsage({
    userId: params.userId,
    direction: "proactive_job",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    metadata: params.metadata,
  });
}
