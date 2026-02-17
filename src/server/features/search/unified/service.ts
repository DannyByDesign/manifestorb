import type { CalendarEvent } from "@/features/calendar/event-types";
import {
  searchConversationHistory,
  searchKnowledge,
  searchMemoryFacts,
} from "@/features/memory/embeddings/search";
import { listRulePlaneRulesByType } from "@/server/features/policy-plane/service";
import type { CanonicalRule } from "@/server/features/policy-plane/canonical-schema";
import type { ParsedMessage } from "@/server/lib/types";
import { searchIndexedDocuments } from "@/server/features/search/index/repository";
import { rankDocuments } from "@/server/features/search/unified/ranking";
import type {
  RankingDocument,
  UnifiedSearchEnvironment,
  UnifiedSearchItem,
  UnifiedSearchMailbox,
  UnifiedSearchRequest,
  UnifiedSearchResult,
  UnifiedSearchSurface,
} from "@/server/features/search/unified/types";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;
const DEFAULT_SURFACES: UnifiedSearchSurface[] = [
  "email",
  "calendar",
  "rule",
  "memory",
];

const DAY_MS = 24 * 60 * 60 * 1000;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function normalizeString(value: string | undefined): string {
  return value?.trim() ?? "";
}

function normalizeSurfaceList(scopes: UnifiedSearchRequest["scopes"]): UnifiedSearchSurface[] {
  if (!Array.isArray(scopes) || scopes.length === 0) return [...DEFAULT_SURFACES];
  const valid = scopes.filter((scope): scope is UnifiedSearchSurface =>
    DEFAULT_SURFACES.includes(scope),
  );
  return valid.length > 0 ? Array.from(new Set(valid)) : [...DEFAULT_SURFACES];
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed);
}

function inferEmailMailbox(message: ParsedMessage): string | undefined {
  const labels = message.labelIds ?? [];
  if (labels.includes("SENT")) return "sent";
  if (labels.includes("INBOX")) return "inbox";
  if (labels.includes("DRAFT")) return "draft";
  if (labels.includes("TRASH")) return "trash";
  if (labels.includes("SPAM")) return "spam";
  return undefined;
}

function tokenInQuery(query: string, token: string): boolean {
  return query.toLowerCase().includes(token.toLowerCase());
}

function appendToken(query: string, token: string): string {
  if (!token.trim()) return query.trim();
  if (tokenInQuery(query, token)) return query.trim();
  if (!query.trim()) return token;
  return `${query.trim()} ${token}`.trim();
}

function mailboxQueryToken(mailbox: UnifiedSearchMailbox | undefined): string | undefined {
  switch (mailbox) {
    case "inbox":
      return "in:inbox";
    case "sent":
      return "in:sent";
    case "draft":
      return "in:draft";
    case "trash":
      return "in:trash";
    case "spam":
      return "in:spam";
    case "archive":
      return "in:archive";
    default:
      return undefined;
  }
}

function buildRankingQuery(request: UnifiedSearchRequest): string {
  const parts = [
    normalizeString(request.query),
    normalizeString(request.text),
    normalizeString(request.from),
    normalizeString(request.to),
    normalizeString(request.attendeeEmail),
  ].filter((part) => part.length > 0);

  return parts.join(" ").trim();
}

function includeRuleByQuery(rule: CanonicalRule, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const haystack = [
    rule.name ?? "",
    rule.description ?? "",
    rule.source.sourceNl ?? "",
    rule.match.resource,
    rule.match.operation ?? "",
    ...(rule.actionPlan?.actions ?? []).map((action) => action.actionType),
  ]
    .join(" ")
    .toLowerCase();

  const tokens = normalizedQuery.split(/[^a-z0-9@._-]+/u).filter((token) => token.length > 0);
  if (tokens.length === 0) return true;
  return tokens.every((token) => haystack.includes(token));
}

function toIsoTimestamp(dateValue: Date | string | undefined): string | undefined {
  if (!dateValue) return undefined;
  if (dateValue instanceof Date) {
    return Number.isFinite(dateValue.getTime()) ? dateValue.toISOString() : undefined;
  }
  const parsed = Date.parse(dateValue);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function toEmailDocument(message: ParsedMessage): RankingDocument {
  const from = message.headers?.from ?? "";
  const to = message.headers?.to ?? "";
  const subject = message.subject || message.headers?.subject || "(No Subject)";
  const snippet = [message.snippet, message.textPlain]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .slice(0, 500);

  return {
    id: `email:${message.id}`,
    surface: "email",
    title: subject,
    snippet,
    timestamp: toIsoTimestamp(message.internalDate ? new Date(Number(message.internalDate)) : message.date),
    metadata: {
      messageId: message.id,
      threadId: message.threadId,
      from,
      to,
      mailbox: inferEmailMailbox(message),
      hasAttachment: Array.isArray(message.attachments) && message.attachments.length > 0,
      attachmentCount: message.attachments?.length ?? 0,
    },
  };
}

function toCalendarDocument(event: CalendarEvent): RankingDocument {
  const attendees = (event.attendees ?? []).map((attendee) => attendee.email).filter(Boolean);
  const snippet = [event.description, event.location, attendees.join(", ")]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" | ")
    .slice(0, 500);

  return {
    id: `calendar:${event.id}`,
    surface: "calendar",
    title: event.title || "(Untitled Event)",
    snippet,
    timestamp: toIsoTimestamp(event.startTime),
    metadata: {
      eventId: event.id,
      provider: event.provider,
      calendarId: event.calendarId,
      attendees,
      start: event.startTime.toISOString(),
      end: event.endTime.toISOString(),
      location: event.location ?? null,
    },
  };
}

function toRuleDocument(rule: CanonicalRule): RankingDocument {
  const actionTypes = (rule.actionPlan?.actions ?? []).map((action) => action.actionType);
  const snippet = [
    rule.description,
    rule.source.sourceNl,
    `resource=${rule.match.resource}`,
    rule.match.operation ? `operation=${rule.match.operation}` : "",
    actionTypes.length > 0 ? `actions=${actionTypes.join(",")}` : "",
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" | ")
    .slice(0, 500);

  return {
    id: `rule:${rule.id}`,
    surface: "rule",
    title: rule.name ?? `${rule.type} rule`,
    snippet,
    metadata: {
      ruleId: rule.id,
      type: rule.type,
      enabled: rule.enabled,
      priority: rule.priority,
      resource: rule.match.resource,
      operation: rule.match.operation ?? null,
      actionTypes,
    },
  };
}

function toSurfaceId(row: {
  connector: string;
  sourceType: string;
  sourceId: string;
}): { surface: UnifiedSearchSurface; id: string } | null {
  if (row.connector === "email") {
    return { surface: "email", id: `email:${row.sourceId}` };
  }
  if (row.connector === "calendar") {
    return { surface: "calendar", id: `calendar:${row.sourceId}` };
  }
  if (row.connector === "rule") {
    return { surface: "rule", id: `rule:${row.sourceId}` };
  }
  if (row.connector === "memory") {
    return { surface: "memory", id: `memory:${row.sourceType}:${row.sourceId}` };
  }
  return null;
}

async function searchIndexedSurface(params: {
  env: UnifiedSearchEnvironment;
  scopes: UnifiedSearchSurface[];
  query: string;
  limit: number;
}): Promise<RankingDocument[]> {
  if (!params.query.trim()) return [];

  const rows = await searchIndexedDocuments({
    userId: params.env.userId,
    emailAccountId: params.env.emailAccountId,
    query: params.query,
    connectors: params.scopes,
    limit: clampInt(params.limit * 8, 50, 2000),
  });

  const docs: RankingDocument[] = [];
  for (const row of rows) {
    const mapped = toSurfaceId(row);
    if (!mapped) continue;
    docs.push({
      id: mapped.id,
      surface: mapped.surface,
      title: row.title ?? "(Untitled)",
      snippet: (row.snippet ?? row.bodyText ?? "").slice(0, 500),
      timestamp: toIsoTimestamp(row.updatedSourceAt ?? row.occurredAt ?? row.startAt ?? undefined),
      metadata: {
        indexed: true,
        connector: row.connector,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        sourceParentId: row.sourceParentId,
        url: row.url,
        authorIdentity: row.authorIdentity,
        freshnessScore: row.freshnessScore,
        authorityScore: row.authorityScore,
        ...(row.metadata ?? {}),
      },
    });
  }
  return docs;
}

function normalizeMailbox(mailbox: UnifiedSearchRequest["mailbox"]): UnifiedSearchMailbox | undefined {
  if (!mailbox) return undefined;
  return mailbox;
}

async function searchEmailSurface(params: {
  env: UnifiedSearchEnvironment;
  request: UnifiedSearchRequest;
  limit: number;
}): Promise<RankingDocument[]> {
  const mailbox = normalizeMailbox(params.request.mailbox);
  const queryBase = normalizeString(params.request.query) || normalizeString(params.request.text);
  const queryWithMailbox = appendToken(queryBase, mailboxQueryToken(mailbox) ?? "");
  const dateBefore = parseDate(params.request.dateRange?.before);
  const dateAfter = parseDate(params.request.dateRange?.after);

  const providerLimit = params.request.fetchAll
    ? clampInt(params.limit * 8, 50, 2500)
    : clampInt(params.limit * 5, 20, 1000);

  const response = await params.env.providers.email.search({
    query: queryWithMailbox,
    limit: providerLimit,
    fetchAll: Boolean(params.request.fetchAll),
    before: dateBefore,
    after: dateAfter,
    text: normalizeString(params.request.text) || undefined,
    from: normalizeString(params.request.from) || undefined,
    to: normalizeString(params.request.to) || undefined,
    sentByMe: mailbox === "sent" ? true : undefined,
    receivedByMe: mailbox === "inbox" ? true : undefined,
  });

  return response.messages.map(toEmailDocument);
}

async function searchCalendarSurface(params: {
  env: UnifiedSearchEnvironment;
  request: UnifiedSearchRequest;
}): Promise<RankingDocument[]> {
  const now = Date.now();
  const start = parseDate(params.request.dateRange?.after) ?? new Date(now - 30 * DAY_MS);
  const end = parseDate(params.request.dateRange?.before) ?? new Date(now + 180 * DAY_MS);
  const normalizedEnd = end.getTime() > start.getTime() ? end : new Date(start.getTime() + 30 * DAY_MS);

  const attendeeEmail =
    normalizeString(params.request.attendeeEmail) ||
    (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizeString(params.request.from))
      ? normalizeString(params.request.from)
      : undefined);

  const events = await params.env.providers.calendar.searchEvents(
    normalizeString(params.request.query) || normalizeString(params.request.text),
    {
      start,
      end: normalizedEnd,
    },
    attendeeEmail,
  );

  return events.map(toCalendarDocument);
}

async function searchRuleSurface(params: {
  env: UnifiedSearchEnvironment;
  request: UnifiedSearchRequest;
}): Promise<RankingDocument[]> {
  const rules = await listRulePlaneRulesByType({
    userId: params.env.userId,
    emailAccountId: params.env.emailAccountId,
  });
  const query = normalizeString(params.request.query) || normalizeString(params.request.text);

  return rules.filter((rule) => includeRuleByQuery(rule, query)).map(toRuleDocument);
}

async function searchMemorySurface(params: {
  env: UnifiedSearchEnvironment;
  request: UnifiedSearchRequest;
  limit: number;
}): Promise<RankingDocument[]> {
  const query = buildRankingQuery(params.request);
  if (!query) return [];

  const perSourceLimit = clampInt(Math.max(3, Math.ceil(params.limit / 2)), 3, 40);
  const [facts, knowledge, conversation] = await Promise.all([
    searchMemoryFacts({
      userId: params.env.userId,
      query,
      limit: perSourceLimit,
    }),
    searchKnowledge({
      userId: params.env.userId,
      query,
      limit: Math.min(20, perSourceLimit),
    }),
    searchConversationHistory({
      userId: params.env.userId,
      query,
      limit: perSourceLimit,
    }),
  ]);

  const docs: RankingDocument[] = [];

  for (const fact of facts) {
    docs.push({
      id: `memory-fact:${fact.item.id}`,
      surface: "memory",
      title: fact.item.key,
      snippet: fact.item.value,
      timestamp: fact.item.updatedAt.toISOString(),
      metadata: {
        source: "memory_fact",
        factId: fact.item.id,
        confidence: fact.item.confidence,
        matchType: fact.matchType,
      },
    });
  }

  for (const item of knowledge) {
    docs.push({
      id: `knowledge:${item.item.id}`,
      surface: "memory",
      title: item.item.title,
      snippet: item.item.content.slice(0, 500),
      timestamp: toIsoTimestamp(item.item.updatedAt),
      metadata: {
        source: "knowledge",
        knowledgeId: item.item.id,
        matchType: item.matchType,
      },
    });
  }

  for (const item of conversation) {
    docs.push({
      id: `conversation:${item.item.id}`,
      surface: "memory",
      title: `Conversation (${item.item.role})`,
      snippet: item.item.content.slice(0, 500),
      timestamp: item.item.createdAt.toISOString(),
      metadata: {
        source: "conversation",
        conversationId: item.item.conversationId,
        role: item.item.role,
        matchType: item.matchType,
      },
    });
  }

  return docs;
}

function toUnifiedItem(entry: Awaited<ReturnType<typeof rankDocuments>>[number]): UnifiedSearchItem {
  return {
    surface: entry.doc.surface,
    id: entry.doc.id,
    title: entry.doc.title,
    snippet: entry.doc.snippet,
    timestamp: entry.doc.timestamp,
    score: entry.score,
    lexicalScore: entry.lexicalScore,
    semanticScore: entry.semanticScore,
    metadata: entry.doc.metadata,
  };
}

export interface UnifiedSearchService {
  query(request: UnifiedSearchRequest): Promise<UnifiedSearchResult>;
}

export function createUnifiedSearchService(env: UnifiedSearchEnvironment): UnifiedSearchService {
  return {
    async query(request) {
      const scopes = normalizeSurfaceList(request.scopes);
      const limit = clampInt(request.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
      const rankingQuery = buildRankingQuery(request);
      const indexedDocs = await searchIndexedSurface({
        env,
        scopes,
        query: rankingQuery,
        limit,
      });

      const fetches: Array<Promise<RankingDocument[]>> = [];
      if (scopes.includes("email")) {
        fetches.push(
          searchEmailSurface({
            env,
            request,
            limit,
          }),
        );
      }
      if (scopes.includes("calendar")) {
        fetches.push(
          searchCalendarSurface({
            env,
            request,
          }),
        );
      }
      if (scopes.includes("rule")) {
        fetches.push(
          searchRuleSurface({
            env,
            request,
          }),
        );
      }
      if (scopes.includes("memory")) {
        fetches.push(
          searchMemorySurface({
            env,
            request,
            limit,
          }),
        );
      }

      const liveDocs = (await Promise.all(fetches)).flat();
      const docsById = new Map<string, RankingDocument>();
      for (const doc of indexedDocs) {
        docsById.set(doc.id, doc);
      }
      for (const doc of liveDocs) {
        if (!docsById.has(doc.id)) {
          docsById.set(doc.id, doc);
        }
      }
      const docs = Array.from(docsById.values());

      const ranked = await rankDocuments({
        query: rankingQuery,
        docs,
      });

      const filteredRanked = rankingQuery
        ? ranked.filter((entry) => entry.score >= 0.12)
        : ranked;

      const total = filteredRanked.length;
      const top = filteredRanked.slice(0, limit).map(toUnifiedItem);

      const counts: Record<UnifiedSearchSurface, number> = {
        email: 0,
        calendar: 0,
        rule: 0,
        memory: 0,
      };
      for (const item of top) {
        counts[item.surface] += 1;
      }

      return {
        items: top,
        counts,
        total,
        truncated: total > limit,
      };
    },
  };
}
