import { createHash } from "crypto";
import prisma from "@/server/db/client";
import { resolvedSlotsSchema, type ResolvedSlots } from "@/server/features/ai/skills/contracts/slot-types";
import { BASELINE_SKILL_IDS, type SkillId } from "@/server/features/ai/skills/baseline/skill-ids";

const PENDING_STATE_TTL_SECONDS = 15 * 60;

export interface PendingSkillRunStateContext {
  provider: string;
  conversationId?: string;
  channelId?: string;
  threadId?: string;
}

export interface PendingSkillRunStateValue {
  id: string;
  correlationId: string;
  skillId: SkillId;
  resolvedSlots: ResolvedSlots;
  missingSlots: string[];
  ambiguousSlots: string[];
  clarificationPrompt?: string;
  expiresAt: Date;
}

function toSkillId(value: unknown): SkillId | null {
  if (typeof value !== "string") return null;
  return BASELINE_SKILL_IDS.includes(value as SkillId) ? (value as SkillId) : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseResolvedSlots(value: unknown): ResolvedSlots {
  const parsed = resolvedSlotsSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function scoreCandidate(params: {
  candidate: {
    provider: string;
    conversationId: string | null;
    channelId: string | null;
    threadId: string | null;
  };
  context: PendingSkillRunStateContext;
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
  skillId: SkillId;
  context: PendingSkillRunStateContext;
}): string {
  return createHash("sha256")
    .update(
      [
        params.userId,
        params.emailAccountId,
        params.skillId,
        params.context.provider,
        params.context.conversationId ?? "",
        params.context.channelId ?? "",
        params.context.threadId ?? "",
        Date.now().toString(),
      ].join(":"),
    )
    .digest("hex");
}

export async function getActivePendingSkillRunState(params: {
  userId: string;
  emailAccountId: string;
  context: PendingSkillRunStateContext;
}): Promise<PendingSkillRunStateValue | null> {
  const now = new Date();

  await prisma.pendingSkillRunState.updateMany({
    where: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      status: "PENDING",
      expiresAt: { lte: now },
    },
    data: { status: "EXPIRED" },
  });

  const candidates = await prisma.pendingSkillRunState.findMany({
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
      skillId: true,
      resolvedSlots: true,
      missingSlots: true,
      ambiguousSlots: true,
      clarificationPrompt: true,
      expiresAt: true,
    },
  });

  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((candidate) => ({
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
    .sort((a, b) => b.score - a.score);

  const selected = ranked[0]?.candidate;
  if (!selected) return null;

  const skillId = toSkillId(selected.skillId);
  if (!skillId) return null;

  return {
    id: selected.id,
    correlationId: selected.correlationId,
    skillId,
    resolvedSlots: parseResolvedSlots(selected.resolvedSlots),
    missingSlots: toStringArray(selected.missingSlots),
    ambiguousSlots: toStringArray(selected.ambiguousSlots),
    clarificationPrompt:
      typeof selected.clarificationPrompt === "string"
        ? selected.clarificationPrompt
        : undefined,
    expiresAt: selected.expiresAt,
  };
}

export async function savePendingSkillRunState(params: {
  userId: string;
  emailAccountId: string;
  context: PendingSkillRunStateContext;
  skillId: SkillId;
  resolvedSlots: ResolvedSlots;
  missingSlots: string[];
  ambiguousSlots: string[];
  clarificationPrompt?: string;
  existingStateId?: string;
  ttlSeconds?: number;
}): Promise<PendingSkillRunStateValue> {
  const ttlSeconds = params.ttlSeconds ?? PENDING_STATE_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  if (params.existingStateId) {
    const updated = await prisma.pendingSkillRunState.update({
      where: { id: params.existingStateId },
      data: {
        status: "PENDING",
        skillId: params.skillId,
        resolvedSlots: params.resolvedSlots,
        missingSlots: params.missingSlots,
        ambiguousSlots: params.ambiguousSlots,
        clarificationPrompt: params.clarificationPrompt ?? null,
        expiresAt,
      },
      select: {
        id: true,
        correlationId: true,
        skillId: true,
        resolvedSlots: true,
        missingSlots: true,
        ambiguousSlots: true,
        clarificationPrompt: true,
        expiresAt: true,
      },
    });

    return {
      id: updated.id,
      correlationId: updated.correlationId,
      skillId: updated.skillId as SkillId,
      resolvedSlots: parseResolvedSlots(updated.resolvedSlots),
      missingSlots: toStringArray(updated.missingSlots),
      ambiguousSlots: toStringArray(updated.ambiguousSlots),
      clarificationPrompt:
        typeof updated.clarificationPrompt === "string"
          ? updated.clarificationPrompt
          : undefined,
      expiresAt: updated.expiresAt,
    };
  }

  await prisma.pendingSkillRunState.updateMany({
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

  const created = await prisma.pendingSkillRunState.create({
    data: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      provider: params.context.provider,
      conversationId: params.context.conversationId ?? null,
      channelId: params.context.channelId ?? null,
      threadId: params.context.threadId ?? null,
      status: "PENDING",
      skillId: params.skillId,
      correlationId: computeCorrelationId({
        userId: params.userId,
        emailAccountId: params.emailAccountId,
        skillId: params.skillId,
        context: params.context,
      }),
      resolvedSlots: params.resolvedSlots,
      missingSlots: params.missingSlots,
      ambiguousSlots: params.ambiguousSlots,
      clarificationPrompt: params.clarificationPrompt ?? null,
      expiresAt,
    },
    select: {
      id: true,
      correlationId: true,
      skillId: true,
      resolvedSlots: true,
      missingSlots: true,
      ambiguousSlots: true,
      clarificationPrompt: true,
      expiresAt: true,
    },
  });

  return {
    id: created.id,
    correlationId: created.correlationId,
    skillId: created.skillId as SkillId,
    resolvedSlots: parseResolvedSlots(created.resolvedSlots),
    missingSlots: toStringArray(created.missingSlots),
    ambiguousSlots: toStringArray(created.ambiguousSlots),
    clarificationPrompt:
      typeof created.clarificationPrompt === "string"
        ? created.clarificationPrompt
        : undefined,
    expiresAt: created.expiresAt,
  };
}

export async function markPendingSkillRunStateResolved(params: {
  stateId: string;
  status?: "RESOLVED" | "CANCELED" | "EXPIRED";
}): Promise<void> {
  await prisma.pendingSkillRunState.updateMany({
    where: { id: params.stateId },
    data: { status: params.status ?? "RESOLVED" },
  });
}
