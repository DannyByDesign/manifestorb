import { createHash } from "crypto";
import prisma from "@/server/db/client";
import { capabilityNameSchema, type CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";

const PENDING_PLANNER_STATE_TTL_SECONDS = 15 * 60;

export interface PendingPlannerRunStateContext {
  provider: string;
  conversationId?: string;
  channelId?: string;
  threadId?: string;
}

export interface PendingPlannerRunStateValue {
  id: string;
  correlationId: string;
  baseMessage: string;
  candidateCapabilities: CapabilityName[];
  clarificationPrompt?: string;
  missingFields: string[];
  expiresAt: Date;
}

type PendingPlannerCandidateRow = {
  id: string;
  correlationId: string;
  provider: string;
  conversationId: string | null;
  channelId: string | null;
  threadId: string | null;
  baseMessage: string;
  candidateCapabilities: unknown;
  clarificationPrompt: string | null;
  missingFields: unknown;
  expiresAt: Date;
};

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseCapabilities(value: unknown): CapabilityName[] {
  const raw = toStringArray(value);
  return raw
    .map((item) => capabilityNameSchema.safeParse(item))
    .filter((result): result is { success: true; data: CapabilityName } => result.success)
    .map((result) => result.data);
}

function scoreCandidate(params: {
  candidate: {
    provider: string;
    conversationId: string | null;
    channelId: string | null;
    threadId: string | null;
  };
  context: PendingPlannerRunStateContext;
}): number {
  let score = 0;
  if (params.candidate.provider === params.context.provider) score += 2;
  if (
    params.context.conversationId &&
    params.candidate.conversationId === params.context.conversationId
  ) {
    score += 20;
  }
  if (params.context.channelId && params.candidate.channelId === params.context.channelId) {
    score += 5;
  }
  if (params.context.threadId && params.candidate.threadId === params.context.threadId) {
    score += 15;
  }
  if (
    params.context.provider &&
    params.context.channelId &&
    params.context.threadId &&
    params.candidate.provider === params.context.provider &&
    params.candidate.channelId === params.context.channelId &&
    params.candidate.threadId === params.context.threadId
  ) {
    score += 25;
  }
  return score;
}

function computeCorrelationId(params: {
  userId: string;
  emailAccountId: string;
  context: PendingPlannerRunStateContext;
  baseMessage: string;
}): string {
  return createHash("sha256")
    .update(
      [
        params.userId,
        params.emailAccountId,
        params.context.provider,
        params.context.conversationId ?? "",
        params.context.channelId ?? "",
        params.context.threadId ?? "",
        params.baseMessage,
        Date.now().toString(),
      ].join(":"),
    )
    .digest("hex");
}

export async function getActivePendingPlannerRunState(params: {
  userId: string;
  emailAccountId: string;
  context: PendingPlannerRunStateContext;
}): Promise<PendingPlannerRunStateValue | null> {
  const now = new Date();

  await prisma.pendingPlannerRunState.updateMany({
    where: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      status: "PENDING",
      expiresAt: { lte: now },
    },
    data: { status: "EXPIRED" },
  });

  const candidates: PendingPlannerCandidateRow[] = await prisma.pendingPlannerRunState.findMany({
    where: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      status: "PENDING",
      expiresAt: { gt: now },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      correlationId: true,
      provider: true,
      conversationId: true,
      channelId: true,
      threadId: true,
      baseMessage: true,
      candidateCapabilities: true,
      clarificationPrompt: true,
      missingFields: true,
      expiresAt: true,
    },
  });

  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((candidate: PendingPlannerCandidateRow) => ({
      candidate,
      score: scoreCandidate({
        candidate: {
          provider: candidate.provider,
          conversationId: candidate.conversationId,
          channelId: candidate.channelId,
          threadId: candidate.threadId,
        },
        context: params.context,
      }),
    }))
    .sort(
      (
        a: { candidate: PendingPlannerCandidateRow; score: number },
        b: { candidate: PendingPlannerCandidateRow; score: number },
      ) => b.score - a.score,
    );

  const selected = ranked[0]?.candidate;
  if (!selected) return null;

  return {
    id: selected.id,
    correlationId: selected.correlationId,
    baseMessage: selected.baseMessage,
    candidateCapabilities: parseCapabilities(selected.candidateCapabilities),
    clarificationPrompt:
      typeof selected.clarificationPrompt === "string"
        ? selected.clarificationPrompt
        : undefined,
    missingFields: toStringArray(selected.missingFields),
    expiresAt: selected.expiresAt,
  };
}

export async function savePendingPlannerRunState(params: {
  userId: string;
  emailAccountId: string;
  context: PendingPlannerRunStateContext;
  baseMessage: string;
  candidateCapabilities: CapabilityName[];
  clarificationPrompt?: string;
  missingFields?: string[];
  existingStateId?: string;
  ttlSeconds?: number;
}): Promise<PendingPlannerRunStateValue> {
  const ttlSeconds = params.ttlSeconds ?? PENDING_PLANNER_STATE_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  if (params.existingStateId) {
    const updated = await prisma.pendingPlannerRunState.update({
      where: { id: params.existingStateId },
      data: {
        status: "PENDING",
        baseMessage: params.baseMessage,
        candidateCapabilities: params.candidateCapabilities,
        clarificationPrompt: params.clarificationPrompt ?? null,
        missingFields: params.missingFields ?? [],
        expiresAt,
      },
      select: {
        id: true,
        correlationId: true,
        baseMessage: true,
        candidateCapabilities: true,
        clarificationPrompt: true,
        missingFields: true,
        expiresAt: true,
      },
    });

    return {
      id: updated.id,
      correlationId: updated.correlationId,
      baseMessage: updated.baseMessage,
      candidateCapabilities: parseCapabilities(updated.candidateCapabilities),
      clarificationPrompt:
        typeof updated.clarificationPrompt === "string"
          ? updated.clarificationPrompt
          : undefined,
      missingFields: toStringArray(updated.missingFields),
      expiresAt: updated.expiresAt,
    };
  }

  await prisma.pendingPlannerRunState.updateMany({
    where: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      status: "PENDING",
      conversationId: params.context.conversationId ?? null,
      provider: params.context.provider,
      channelId: params.context.channelId ?? null,
      threadId: params.context.threadId ?? null,
    },
    data: { status: "CANCELED" },
  });

  const created = await prisma.pendingPlannerRunState.create({
    data: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      provider: params.context.provider,
      conversationId: params.context.conversationId ?? null,
      channelId: params.context.channelId ?? null,
      threadId: params.context.threadId ?? null,
      status: "PENDING",
      correlationId: computeCorrelationId({
        userId: params.userId,
        emailAccountId: params.emailAccountId,
        context: params.context,
        baseMessage: params.baseMessage,
      }),
      baseMessage: params.baseMessage,
      candidateCapabilities: params.candidateCapabilities,
      clarificationPrompt: params.clarificationPrompt ?? null,
      missingFields: params.missingFields ?? [],
      expiresAt,
    },
    select: {
      id: true,
      correlationId: true,
      baseMessage: true,
      candidateCapabilities: true,
      clarificationPrompt: true,
      missingFields: true,
      expiresAt: true,
    },
  });

  return {
    id: created.id,
    correlationId: created.correlationId,
    baseMessage: created.baseMessage,
    candidateCapabilities: parseCapabilities(created.candidateCapabilities),
    clarificationPrompt:
      typeof created.clarificationPrompt === "string"
        ? created.clarificationPrompt
        : undefined,
    missingFields: toStringArray(created.missingFields),
    expiresAt: created.expiresAt,
  };
}

export async function markPendingPlannerRunStateResolved(params: {
  stateId: string;
  status?: "RESOLVED" | "CANCELED" | "EXPIRED";
}): Promise<void> {
  await prisma.pendingPlannerRunState.updateMany({
    where: { id: params.stateId },
    data: { status: params.status ?? "RESOLVED" },
  });
}
