import { Prisma } from "@/generated/prisma/client";
import prisma from "@/server/db/client";
import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createCapabilityIdempotencyKey } from "@/server/features/ai/tools/runtime/capabilities/idempotency";

const IDEMPOTENCY_WINDOW_MS = 15 * 60 * 1_000;
const IDEMPOTENCY_RECORD_TTL_MS = 24 * 60 * 60 * 1_000;

type StoredPayload = {
  toolResult?: ToolResult;
};

function asStoredPayload(value: unknown): StoredPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const payload = value as Record<string, unknown>;
  return {
    toolResult:
      payload.toolResult && typeof payload.toolResult === "object"
        ? (payload.toolResult as ToolResult)
        : undefined,
  };
}

function withIdempotencyData(result: ToolResult, key: string, replayed: boolean): ToolResult {
  const idempotency = {
    key,
    replayed,
  };

  if (!result.data) {
    return {
      ...result,
      data: { idempotency },
    };
  }

  if (typeof result.data === "object" && !Array.isArray(result.data)) {
    return {
      ...result,
      data: {
        ...(result.data as Record<string, unknown>),
        idempotency,
      },
    };
  }

  return {
    ...result,
    data: {
      value: result.data,
      idempotency,
    },
  };
}

function buildMutationIdempotencyKey(params: {
  env: CapabilityEnvironment;
  capability: string;
  seed?: string;
  payload: Record<string, unknown>;
}): string {
  const windowBucket = Math.floor(Date.now() / IDEMPOTENCY_WINDOW_MS);
  return createCapabilityIdempotencyKey({
    scope: "conversation",
    userId: params.env.runtime.userId,
    emailAccountId: params.env.runtime.emailAccountId,
    capability: params.capability,
    seed: params.seed,
    payload: {
      payload: params.payload,
      windowBucket,
      conversationId: params.env.runtime.conversationId ?? null,
      currentMessage: params.env.runtime.currentMessage?.trim() ?? null,
    },
  });
}

export async function runMutationWithIdempotency(params: {
  env: CapabilityEnvironment;
  capability: string;
  seed?: string;
  payload: Record<string, unknown>;
  execute: () => Promise<ToolResult>;
}): Promise<ToolResult> {
  const key = buildMutationIdempotencyKey({
    env: params.env,
    capability: params.capability,
    seed: params.seed,
    payload: params.payload,
  });

  const expiresAt = new Date(Date.now() + IDEMPOTENCY_RECORD_TTL_MS);
  let rowId: string | null = null;

  try {
    const created = await prisma.pendingAgentTurnState.create({
      data: {
        userId: params.env.runtime.userId,
        emailAccountId: params.env.runtime.emailAccountId,
        provider: params.env.runtime.provider || "system",
        conversationId: params.env.runtime.conversationId ?? null,
        channelId: null,
        threadId: null,
        status: "PENDING",
        pendingType: "mutation_idempotency",
        correlationId: key,
        payload: {
          capability: params.capability,
        },
        expiresAt,
      },
      select: { id: true },
    });
    rowId = created.id;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.pendingAgentTurnState.findUnique({
        where: { correlationId: key },
        select: {
          status: true,
          payload: true,
        },
      });
      if (existing) {
        const stored = asStoredPayload(existing.payload);
        if (stored.toolResult) {
          return withIdempotencyData(stored.toolResult, key, true);
        }
        if (existing.status === "PENDING") {
          return {
            success: false,
            error: "duplicate_request_in_progress",
            message: "This request is already in progress. Please retry in a moment.",
            data: {
              idempotency: {
                key,
                replayed: true,
                inProgress: true,
              },
            },
          };
        }
      }
    } else {
      params.env.runtime.logger.warn("Failed to create mutation idempotency record", {
        capability: params.capability,
        error,
      });
    }
  }

  const result = await params.execute();
  const finalResult = withIdempotencyData(result, key, false);

  if (rowId) {
    try {
      await prisma.pendingAgentTurnState.update({
        where: { id: rowId },
        data: {
          status: finalResult.success ? "RESOLVED" : "FAILED",
          payload: {
            capability: params.capability,
            toolResult: finalResult,
          },
          expiresAt,
        },
      });
    } catch (error) {
      params.env.runtime.logger.warn("Failed to persist mutation idempotency result", {
        capability: params.capability,
        idempotencyKey: key,
        error,
      });
    }
  }

  return finalResult;
}
