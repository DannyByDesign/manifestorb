import prisma from "@/server/db/client";
import { createScopedLogger, type Logger } from "@/server/lib/logger";
import type { SearchConnector } from "@/server/features/search/index/types";
import {
  enqueueConversationMessageForIndexing,
  enqueueKnowledgeForIndexing,
  enqueueMemoryFactForIndexing,
} from "@/server/features/search/index/ingestors/memory";

const DEFAULT_CONNECTORS: SearchConnector[] = ["memory"];
const DEFAULT_MEMORY_MAX = 3000;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function normalizeConnectors(connectors?: SearchConnector[]): SearchConnector[] {
  if (!Array.isArray(connectors) || connectors.length === 0) {
    return [...DEFAULT_CONNECTORS];
  }
  return connectors.includes("memory") ? ["memory"] : [];
}

export interface SearchBackfillOptions {
  userId: string;
  emailAccountId?: string;
  connectors?: SearchConnector[];
  emailMaxMessages?: number;
  calendarMaxEvents?: number;
  ruleMaxRules?: number;
  memoryMaxItems?: number;
  logger?: Logger;
}

export interface SearchBackfillResult {
  connectors: SearchConnector[];
  queued: number;
  byConnector: Record<SearchConnector, number>;
}

async function backfillMemory(params: {
  userId: string;
  maxItems: number;
  logger: Logger;
}): Promise<number> {
  const max = clampInt(params.maxItems, 1, 30_000);
  const factTake = clampInt(Math.floor(max * 0.45), 1, max);
  const knowledgeTake = clampInt(Math.floor(max * 0.25), 1, max);
  const convoTake = clampInt(max - factTake - knowledgeTake, 1, max);

  const [facts, knowledge, conversation] = await Promise.all([
    prisma.memoryFact.findMany({
      where: { userId: params.userId },
      orderBy: [{ updatedAt: "desc" }],
      take: factTake,
    }),
    prisma.knowledge.findMany({
      where: { userId: params.userId },
      orderBy: [{ updatedAt: "desc" }],
      take: knowledgeTake,
    }),
    prisma.conversationMessage.findMany({
      where: { userId: params.userId },
      orderBy: [{ createdAt: "desc" }],
      take: convoTake,
    }),
  ]);

  await Promise.all([
    ...facts.map((fact) =>
      enqueueMemoryFactForIndexing({
        userId: params.userId,
        fact,
        logger: params.logger,
      }),
    ),
    ...knowledge.map((item) =>
      enqueueKnowledgeForIndexing({
        userId: params.userId,
        knowledge: item,
        logger: params.logger,
      }),
    ),
    ...conversation.map((message) =>
      enqueueConversationMessageForIndexing({
        userId: params.userId,
        message,
        logger: params.logger,
      }),
    ),
  ]);

  return facts.length + knowledge.length + conversation.length;
}

export async function runSearchBackfill(
  options: SearchBackfillOptions,
): Promise<SearchBackfillResult> {
  const logger = options.logger ?? createScopedLogger("search/index/backfill");
  const connectors = normalizeConnectors(options.connectors);
  const byConnector: Record<SearchConnector, number> = {
    email: 0,
    calendar: 0,
    rule: 0,
    memory: 0,
  };

  if (connectors.includes("memory")) {
    byConnector.memory = await backfillMemory({
      userId: options.userId,
      maxItems: clampInt(options.memoryMaxItems ?? DEFAULT_MEMORY_MAX, 20, 30_000),
      logger,
    });
  }

  const queued = byConnector.memory;

  logger.info("Search backfill queued", {
    userId: options.userId,
    emailAccountId: options.emailAccountId,
    connectors,
    byConnector,
    queued,
  });

  return {
    connectors,
    queued,
    byConnector,
  };
}
