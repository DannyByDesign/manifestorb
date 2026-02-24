import type { OpenWorldTurnInput } from "@/server/features/ai/runtime/types";
import prisma from "@/server/db/client";
import type { ContextPack } from "@/server/features/memory/context-manager";
import {
  buildProgressiveRuntimeContext,
  type RuntimeHydrationTier,
} from "@/server/features/ai/runtime/context/retrieval-broker";
import { planRuntimeTurn } from "@/server/features/ai/runtime/turn-planner";

export interface RuntimeHydratedContext {
  message: string;
  contextPack?: ContextPack;
  hydrationTier?: RuntimeHydrationTier;
  contextStatus: "ready" | "degraded" | "missing";
  contextIssues: string[];
  contextStats: {
    facts: number;
    knowledge: number;
    history: number;
    attentionItems: number;
    hasSummary: boolean;
    hasPendingState: boolean;
  };
}

function emptyStats() {
  return {
    facts: 0,
    knowledge: 0,
    history: 0,
    attentionItems: 0,
    hasSummary: false,
    hasPendingState: false,
  };
}

function contextStatsFromPack(contextPack: ContextPack) {
  return {
    facts: contextPack.facts.length,
    knowledge: contextPack.knowledge.length,
    history: contextPack.history.length,
    attentionItems: contextPack.attentionItems?.length ?? 0,
    hasSummary: Boolean(contextPack.system.summary),
    hasPendingState: Boolean(contextPack.pendingState),
  };
}

export async function hydrateRuntimeContext(
  input: OpenWorldTurnInput,
): Promise<RuntimeHydratedContext> {
  const message = input.message.trim();

  if (!message) {
    return {
      message,
      contextStatus: "missing",
      contextIssues: ["empty_message"],
      contextStats: emptyStats(),
    };
  }

  const emailAccount = await prisma.emailAccount.findFirst({
    where: {
      id: input.emailAccountId,
      userId: input.userId,
    },
  });

  if (!emailAccount) {
    return {
      message,
      contextStatus: "missing",
      contextIssues: ["email_account_not_found"],
      contextStats: emptyStats(),
    };
  }

  try {
    const progressive = await buildProgressiveRuntimeContext({
      userId: input.userId,
      emailAccount,
      message,
      turn:
        input.runtimeTurnContract ??
        await planRuntimeTurn({
          userId: input.userId,
          emailAccountId: input.emailAccountId,
          email: input.email,
          provider: input.provider,
          message,
          logger: input.logger,
        }),
      logger: input.logger,
    });

    if (!progressive.contextPack) {
      return {
        message,
        hydrationTier: progressive.tier,
        contextStatus: "degraded",
        contextIssues:
          progressive.issues.length > 0
            ? progressive.issues
            : ["context_hydration_failed"],
        contextStats: emptyStats(),
      };
    }

    return {
      message,
      contextPack: progressive.contextPack,
      hydrationTier: progressive.tier,
      contextStatus: "ready",
      contextIssues: progressive.issues,
      contextStats: contextStatsFromPack(progressive.contextPack),
    };
  } catch (error) {
    input.logger.warn("Runtime context hydration degraded", {
      userId: input.userId,
      emailAccountId: input.emailAccountId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      message,
      contextStatus: "degraded",
      contextIssues: ["context_hydration_failed"],
      contextStats: emptyStats(),
    };
  }
}
