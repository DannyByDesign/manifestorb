import type { EmailAccount } from "@/generated/prisma/client";
import { ContextManager, type ContextPack } from "@/server/features/memory/context-manager";
import type { RuntimeTurnContract } from "@/server/features/ai/runtime/turn-contract";
import { hasRecallSignals } from "@/server/features/ai/runtime/turn-compiler";
import type { Logger } from "@/server/lib/logger";

export type RuntimeHydrationTier = "bootstrap" | "targeted" | "expanded";

export interface RuntimeProgressiveContextResult {
  contextPack?: ContextPack;
  tier?: RuntimeHydrationTier;
  issues: string[];
}

const BOOTSTRAP_TIMEOUT_MS_DEFAULT = 250;
const TARGETED_TIMEOUT_MS_DEFAULT = 700;
const EXPANDED_TIMEOUT_MS_DEFAULT = 3_000;

async function withTimeout<T>(params: {
  timeoutMs: number;
  run: () => Promise<T>;
}): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      params.run(),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("context_hydration_timeout")), params.timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolveTimeoutMs(envName: string, fallback: number, min: number, max: number): number {
  const raw = process.env[envName];
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function needsTargetedTier(params: {
  message: string;
  turn: RuntimeTurnContract;
}): boolean {
  if (hasRecallSignals(params.message)) return true;
  if (params.turn.routeHint === "conversation_only") return false;
  return true;
}

function needsExpandedTier(turn: RuntimeTurnContract): boolean {
  return (
    turn.routeHint === "planner" ||
    turn.complexity === "complex" ||
    turn.domain === "cross_surface"
  );
}

async function buildTierContext(params: {
  userId: string;
  emailAccount: EmailAccount;
  message: string;
  timeoutMs: number;
  tier: RuntimeHydrationTier;
}): Promise<ContextPack> {
  const options =
    params.tier === "bootstrap"
      ? {
          contextTier: 1 as const,
          includePendingState: true,
          includeDomainData: false,
          includeAttentionItems: false,
        }
      : params.tier === "targeted"
        ? {
            contextTier: 2 as const,
            includePendingState: true,
            includeDomainData: false,
            includeAttentionItems: false,
          }
        : {
            contextTier: 3 as const,
            includePendingState: true,
            includeDomainData: true,
            includeAttentionItems: true,
          };

  return await withTimeout({
    timeoutMs: params.timeoutMs,
    run: async () =>
      ContextManager.buildContextPack({
        user: { id: params.userId },
        emailAccount: params.emailAccount,
        messageContent: params.message,
        options,
      }),
  });
}

export async function buildProgressiveRuntimeContext(params: {
  userId: string;
  emailAccount: EmailAccount;
  message: string;
  turn: RuntimeTurnContract;
  logger: Logger;
}): Promise<RuntimeProgressiveContextResult> {
  const issues: string[] = [];

  const bootstrapTimeoutMs = resolveTimeoutMs(
    "RUNTIME_CONTEXT_BOOTSTRAP_TIMEOUT_MS",
    BOOTSTRAP_TIMEOUT_MS_DEFAULT,
    100,
    2_000,
  );
  const targetedTimeoutMs = resolveTimeoutMs(
    "RUNTIME_CONTEXT_TARGETED_TIMEOUT_MS",
    TARGETED_TIMEOUT_MS_DEFAULT,
    150,
    4_000,
  );
  const expandedTimeoutMs = resolveTimeoutMs(
    "RUNTIME_CONTEXT_EXPANDED_TIMEOUT_MS",
    EXPANDED_TIMEOUT_MS_DEFAULT,
    500,
    8_000,
  );

  let bestPack: ContextPack | undefined;
  let bestTier: RuntimeHydrationTier | undefined;

  try {
    bestPack = await buildTierContext({
      userId: params.userId,
      emailAccount: params.emailAccount,
      message: params.message,
      timeoutMs: bootstrapTimeoutMs,
      tier: "bootstrap",
    });
    bestTier = "bootstrap";
  } catch (error) {
    params.logger.warn("Bootstrap context tier failed", { error });
    issues.push("context_bootstrap_failed");
  }

  if (needsTargetedTier({ message: params.message, turn: params.turn })) {
    try {
      const targeted = await buildTierContext({
        userId: params.userId,
        emailAccount: params.emailAccount,
        message: params.message,
        timeoutMs: targetedTimeoutMs,
        tier: "targeted",
      });
      bestPack = targeted;
      bestTier = "targeted";
    } catch (error) {
      params.logger.warn("Targeted context tier failed", { error });
      issues.push("context_targeted_failed");
    }
  }

  if (needsExpandedTier(params.turn)) {
    try {
      const expanded = await buildTierContext({
        userId: params.userId,
        emailAccount: params.emailAccount,
        message: params.message,
        timeoutMs: expandedTimeoutMs,
        tier: "expanded",
      });
      bestPack = expanded;
      bestTier = "expanded";
    } catch (error) {
      params.logger.warn("Expanded context tier failed", { error });
      issues.push("context_expanded_failed");
    }
  }

  return {
    contextPack: bestPack,
    tier: bestTier,
    issues,
  };
}
