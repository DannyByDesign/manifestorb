import prisma from "@/server/db/client";
import { createScopedLogger, type Logger } from "@/server/lib/logger";
import { createEmailProvider } from "@/features/email/provider";
import type { SearchConnector } from "@/server/features/search/index/types";
import { SearchIndexQueue } from "@/server/features/search/index/queue";
import { enqueueEmailDocumentForIndexing } from "@/server/features/search/index/ingestors/email";
import { enqueueRuleDocumentForIndexing } from "@/server/features/search/index/ingestors/rule";
import {
  enqueueConversationMessageForIndexing,
  enqueueKnowledgeForIndexing,
  enqueueMemoryFactForIndexing,
} from "@/server/features/search/index/ingestors/memory";
import { listPersistedCanonicalRules } from "@/server/features/policy-plane/repository";
import type { ParsedMessage } from "@/server/lib/types";

const DEFAULT_CONNECTORS: SearchConnector[] = [
  "email",
  "calendar",
  "rule",
  "memory",
];

const DEFAULT_EMAIL_MAX = 1200;
const DEFAULT_CALENDAR_MAX = 1500;
const DEFAULT_RULE_MAX = 1000;
const DEFAULT_MEMORY_MAX = 3000;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toIso(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
}

function computeFreshnessScore(isoLike: string | undefined): number {
  if (!isoLike) return 0;
  const ts = Date.parse(isoLike);
  if (!Number.isFinite(ts)) return 0;
  const days = Math.max(0, (Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (days <= 1) return 1;
  if (days <= 7) return 0.85;
  if (days <= 30) return 0.6;
  if (days <= 90) return 0.35;
  return 0.2;
}

function normalizeConnectors(connectors?: SearchConnector[]): SearchConnector[] {
  if (!Array.isArray(connectors) || connectors.length === 0) {
    return [...DEFAULT_CONNECTORS];
  }
  const valid = connectors.filter((connector): connector is SearchConnector =>
    DEFAULT_CONNECTORS.includes(connector),
  );
  return valid.length > 0 ? Array.from(new Set(valid)) : [...DEFAULT_CONNECTORS];
}

function dedupeMessages(messages: ParsedMessage[]): ParsedMessage[] {
  const seen = new Set<string>();
  const out: ParsedMessage[] = [];
  for (const message of messages) {
    const id = message.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(message);
  }
  return out;
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

async function backfillEmail(params: {
  userId: string;
  emailAccountId: string;
  maxMessages: number;
  logger: Logger;
}): Promise<number> {
  const account = await prisma.emailAccount.findUnique({
    where: { id: params.emailAccountId },
    select: {
      id: true,
      account: {
        select: {
          provider: true,
        },
      },
    },
  });
  if (!account) return 0;

  const provider = await createEmailProvider({
    emailAccountId: account.id,
    provider: account.account?.provider ?? "google",
    logger: params.logger,
  });
  const limitPerMailbox = clampInt(
    Math.ceil(params.maxMessages / 2),
    50,
    params.maxMessages,
  );

  const [sent, inbox] = await Promise.all([
    provider.getSentMessages(limitPerMailbox),
    provider.getInboxMessages(limitPerMailbox),
  ]);
  const messages = dedupeMessages([...sent, ...inbox]).slice(0, params.maxMessages);
  if (messages.length === 0) return 0;

  const providerName = provider.name === "microsoft" ? "microsoft" : "google";
  await Promise.all(
    messages.map((message) =>
      enqueueEmailDocumentForIndexing({
        userId: params.userId,
        emailAccountId: params.emailAccountId,
        provider: providerName,
        message,
        logger: params.logger,
      }),
    ),
  );

  return messages.length;
}

async function backfillCalendar(params: {
  userId: string;
  emailAccountId?: string;
  maxEvents: number;
  logger: Logger;
}): Promise<number> {
  const rows = await prisma.calendarEventShadow.findMany({
    where: {
      userId: params.userId,
      ...(params.emailAccountId ? { emailAccountId: params.emailAccountId } : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    take: clampInt(params.maxEvents, 1, 20_000),
    select: {
      userId: true,
      emailAccountId: true,
      provider: true,
      calendarId: true,
      externalEventId: true,
      seriesMasterId: true,
      iCalUid: true,
      status: true,
      title: true,
      description: true,
      location: true,
      organizerEmail: true,
      attendees: true,
      allDay: true,
      startTime: true,
      endTime: true,
      canEdit: true,
      canRespond: true,
      busyStatus: true,
      isDeleted: true,
      updatedAt: true,
    },
  });

  for (const row of rows) {
    const attendees = asStringArray(
      Array.isArray(row.attendees)
        ? row.attendees
            .map((attendee) =>
              attendee &&
              typeof attendee === "object" &&
              "email" in attendee &&
              typeof (attendee as { email?: unknown }).email === "string"
                ? (attendee as { email: string }).email
                : undefined,
            )
            .filter(Boolean)
        : [],
    );

    await SearchIndexQueue.enqueueUpsert({
      userId: row.userId,
      emailAccountId: row.emailAccountId ?? undefined,
      connector: "calendar",
      sourceType: "event",
      sourceId: row.externalEventId,
      sourceParentId: row.seriesMasterId ?? undefined,
      title: row.title ?? "(Untitled Event)",
      snippet: row.description ?? row.location ?? "",
      bodyText: [
        row.title,
        row.description,
        row.location,
        attendees.join(" "),
      ]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join("\n"),
      authorIdentity: row.organizerEmail ?? undefined,
      startAt: toIso(row.startTime),
      endAt: toIso(row.endTime),
      occurredAt: toIso(row.startTime),
      updatedSourceAt: toIso(row.updatedAt),
      isDeleted: row.isDeleted,
      freshnessScore: computeFreshnessScore(toIso(row.updatedAt)),
      authorityScore: 0.45,
      metadata: {
        provider: row.provider,
        calendarId: row.calendarId,
        iCalUid: row.iCalUid,
        status: row.status,
        location: row.location,
        allDay: row.allDay,
        canEdit: row.canEdit,
        canRespond: row.canRespond,
        busyStatus: row.busyStatus,
        attendees,
      },
    });
  }

  return rows.length;
}

async function backfillRules(params: {
  userId: string;
  emailAccountId?: string;
  maxRules: number;
  logger: Logger;
}): Promise<number> {
  const rules = await listPersistedCanonicalRules({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
  });
  const selected = rules.slice(0, clampInt(params.maxRules, 1, 20_000));
  await Promise.all(
    selected.map((rule) =>
      enqueueRuleDocumentForIndexing({
        userId: params.userId,
        emailAccountId: params.emailAccountId,
        rule,
        logger: params.logger,
      }),
    ),
  );
  return selected.length;
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

  if (connectors.includes("email") && options.emailAccountId) {
    byConnector.email = await backfillEmail({
      userId: options.userId,
      emailAccountId: options.emailAccountId,
      maxMessages: clampInt(options.emailMaxMessages ?? DEFAULT_EMAIL_MAX, 50, 10_000),
      logger,
    });
  }

  if (connectors.includes("calendar")) {
    byConnector.calendar = await backfillCalendar({
      userId: options.userId,
      emailAccountId: options.emailAccountId,
      maxEvents: clampInt(options.calendarMaxEvents ?? DEFAULT_CALENDAR_MAX, 20, 20_000),
      logger,
    });
  }

  if (connectors.includes("rule")) {
    byConnector.rule = await backfillRules({
      userId: options.userId,
      emailAccountId: options.emailAccountId,
      maxRules: clampInt(options.ruleMaxRules ?? DEFAULT_RULE_MAX, 20, 20_000),
      logger,
    });
  }

  if (connectors.includes("memory")) {
    byConnector.memory = await backfillMemory({
      userId: options.userId,
      maxItems: clampInt(options.memoryMaxItems ?? DEFAULT_MEMORY_MAX, 20, 30_000),
      logger,
    });
  }

  const queued = byConnector.email + byConnector.calendar + byConnector.rule + byConnector.memory;

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
