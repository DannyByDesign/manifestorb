import type { OpenWorldTurnInput } from "@/server/features/ai/runtime/types";
import prisma from "@/server/db/client";
import type { ContextPack } from "@/server/features/memory/context-manager";
import { ContextManager } from "@/server/features/memory/context-manager";

export interface RuntimeHydratedContext {
  message: string;
  contextPack?: ContextPack;
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

const CONTEXT_HYDRATION_TIMEOUT_MS = 3_000;

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

export async function hydrateRuntimeContext(
  input: OpenWorldTurnInput,
): Promise<RuntimeHydratedContext> {
  const message = input.message.trim();
  const issues: string[] = [];

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
    const contextPack = await withTimeout({
      timeoutMs: CONTEXT_HYDRATION_TIMEOUT_MS,
      run: async () =>
        ContextManager.buildContextPack({
          user: { id: input.userId },
          emailAccount,
          messageContent: message,
          options: {
            contextTier: 3,
            includePendingState: true,
            includeDomainData: true,
            includeAttentionItems: true,
          },
        }),
    });

    return {
      message,
      contextPack,
      contextStatus: "ready",
      contextIssues: issues,
      contextStats: {
        facts: contextPack.facts.length,
        knowledge: contextPack.knowledge.length,
        history: contextPack.history.length,
        attentionItems: contextPack.attentionItems?.length ?? 0,
        hasSummary: Boolean(contextPack.system.summary),
        hasPendingState: Boolean(contextPack.pendingState),
      },
    };
  } catch (error) {
    input.logger.warn("Runtime context hydration degraded", {
      userId: input.userId,
      emailAccountId: input.emailAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
    issues.push(
      error instanceof Error && error.message === "context_hydration_timeout"
        ? "context_hydration_timeout"
        : "context_hydration_failed",
    );

    return {
      message,
      contextStatus: "degraded",
      contextIssues: issues,
      contextStats: emptyStats(),
    };
  }
}
