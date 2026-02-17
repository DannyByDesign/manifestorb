import type {
  ConversationMessage,
  Knowledge,
  MemoryFact,
} from "@/generated/prisma/client";
import { SearchIndexQueue } from "@/server/features/search/index/queue";
import type {
  SearchDocumentIdentity,
  SearchIndexedDocument,
} from "@/server/features/search/index/types";
import type { Logger } from "@/server/lib/logger";

const DAY_MS = 24 * 60 * 60 * 1000;

function computeFreshnessScore(isoLike: Date | string | undefined): number {
  if (!isoLike) return 0;
  const ts =
    isoLike instanceof Date ? isoLike.getTime() : Date.parse(isoLike);
  if (!Number.isFinite(ts)) return 0;
  const days = Math.max(0, (Date.now() - ts) / DAY_MS);
  if (days <= 1) return 1;
  if (days <= 7) return 0.82;
  if (days <= 30) return 0.58;
  if (days <= 90) return 0.34;
  return 0.15;
}

function iso(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
}

export async function enqueueMemoryFactForIndexing(params: {
  userId: string;
  fact: MemoryFact;
  logger: Logger;
}) {
  const payload: SearchIndexedDocument = {
    userId: params.userId,
    connector: "memory",
    sourceType: "memory_fact",
    sourceId: params.fact.id,
    title: params.fact.key,
    snippet: params.fact.value.slice(0, 280),
    bodyText: `${params.fact.key}\n${params.fact.value}`,
    occurredAt: iso(params.fact.createdAt),
    updatedSourceAt: iso(params.fact.updatedAt),
    isDeleted: !params.fact.isActive,
    freshnessScore: computeFreshnessScore(params.fact.updatedAt),
    authorityScore: Math.min(Math.max(params.fact.confidence, 0), 1),
    metadata: {
      scope: params.fact.scope,
      confidence: params.fact.confidence,
      sourceMessageId: params.fact.sourceMessageId,
      accessCount: params.fact.accessCount,
      lastAccessedAt: iso(params.fact.lastAccessedAt),
      expiresAt: iso(params.fact.expiresAt),
      isActive: params.fact.isActive,
    },
  };

  try {
    await SearchIndexQueue.enqueueUpsert(payload);
  } catch (error) {
    params.logger.warn("Failed to enqueue memory fact for indexing", {
      userId: params.userId,
      factId: params.fact.id,
      error,
    });
  }
}

export async function enqueueKnowledgeForIndexing(params: {
  userId: string;
  knowledge: Knowledge;
  logger: Logger;
}) {
  const payload: SearchIndexedDocument = {
    userId: params.userId,
    emailAccountId: params.knowledge.emailAccountId ?? undefined,
    connector: "memory",
    sourceType: "knowledge",
    sourceId: params.knowledge.id,
    title: params.knowledge.title,
    snippet: params.knowledge.content.slice(0, 280),
    bodyText: params.knowledge.content,
    occurredAt: iso(params.knowledge.createdAt),
    updatedSourceAt: iso(params.knowledge.updatedAt),
    freshnessScore: computeFreshnessScore(params.knowledge.updatedAt),
    authorityScore: 0.6,
    metadata: {
      source: "knowledge_base",
    },
  };

  try {
    await SearchIndexQueue.enqueueUpsert(payload);
  } catch (error) {
    params.logger.warn("Failed to enqueue knowledge entry for indexing", {
      userId: params.userId,
      knowledgeId: params.knowledge.id,
      error,
    });
  }
}

export async function enqueueConversationMessageForIndexing(params: {
  userId: string;
  message: ConversationMessage;
  logger: Logger;
}) {
  const content =
    typeof params.message.content === "string" ? params.message.content : "";
  const role = typeof params.message.role === "string" ? params.message.role : "unknown";
  const payload: SearchIndexedDocument = {
    userId: params.userId,
    emailAccountId: params.message.emailAccountId ?? undefined,
    connector: "memory",
    sourceType: "conversation_message",
    sourceId: params.message.id,
    sourceParentId: params.message.conversationId,
    title: `${role} message`,
    snippet: content.slice(0, 280),
    bodyText: content,
    authorIdentity: role,
    occurredAt: iso(params.message.createdAt),
    updatedSourceAt: iso(params.message.createdAt),
    freshnessScore: computeFreshnessScore(params.message.createdAt),
    authorityScore: params.message.role === "user" ? 0.55 : 0.45,
    metadata: {
      provider: params.message.provider,
      channelId: params.message.channelId,
      threadId: params.message.threadId,
      role,
      providerMessageId: params.message.providerMessageId,
    },
  };

  try {
    await SearchIndexQueue.enqueueUpsert(payload);
  } catch (error) {
    params.logger.warn("Failed to enqueue conversation message for indexing", {
      userId: params.userId,
      messageId: params.message.id,
      error,
    });
  }
}

export async function enqueueMemoryDeleteForIndexing(params: {
  identity: SearchDocumentIdentity;
  logger: Logger;
}) {
  try {
    await SearchIndexQueue.enqueueDelete(params.identity);
  } catch (error) {
    params.logger.warn("Failed to enqueue memory document delete", {
      identity: params.identity,
      error,
    });
  }
}
