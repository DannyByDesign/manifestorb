import {
  getSearchBehaviorScores,
  listRecentIndexedDocuments,
  recordSearchSignals,
  searchIndexedDocuments,
} from "@/server/features/search/index/repository";
import { enqueueEmailDocumentForIndexing } from "@/server/features/search/index/ingestors/email";
import { planUnifiedSearchQuery } from "@/server/features/search/unified/query";
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

function toIsoTimestamp(dateValue: Date | string | undefined): string | undefined {
  if (!dateValue) return undefined;
  if (dateValue instanceof Date) {
    return Number.isFinite(dateValue.getTime()) ? dateValue.toISOString() : undefined;
  }
  const parsed = Date.parse(dateValue);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function computeFreshnessScore(timestamp: string | undefined): number {
  if (!timestamp) return 0;
  const ts = Date.parse(timestamp);
  if (!Number.isFinite(ts)) return 0;
  const days = Math.max(0, (Date.now() - ts) / DAY_MS);
  if (days <= 1) return 1;
  if (days <= 7) return 0.8;
  if (days <= 30) return 0.55;
  if (days <= 90) return 0.3;
  return 0.1;
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

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function includesNeedle(value: unknown, needle: string): boolean {
  if (!needle) return true;
  const normalizedNeedle = needle.toLowerCase().trim();
  if (!normalizedNeedle) return true;
  if (typeof value === "string") {
    return value.toLowerCase().includes(normalizedNeedle);
  }
  if (Array.isArray(value)) {
    return value.some((item) => includesNeedle(item, normalizedNeedle));
  }
  return false;
}

function computeGraphProximityScore(doc: RankingDocument, terms: string[]): number {
  if (terms.length === 0) return 0;
  const metadata = asObject(doc.metadata);
  const graphTexts = [
    String(metadata.authorIdentity ?? ""),
    String(metadata.from ?? ""),
    String(metadata.to ?? ""),
    Array.isArray(metadata.attendees) ? metadata.attendees.join(" ") : "",
    doc.title,
  ]
    .join(" ")
    .toLowerCase();

  if (!graphTexts.trim()) return 0;
  let matched = 0;
  for (const term of terms) {
    if (term.length <= 1) continue;
    if (graphTexts.includes(term.toLowerCase())) matched += 1;
  }
  if (matched === 0) return 0;
  return Math.min(1, matched / Math.max(1, terms.length));
}

function mailboxMatches(doc: RankingDocument, mailbox: UnifiedSearchMailbox | undefined): boolean {
  if (doc.surface !== "email" || !mailbox || mailbox === "all") return true;
  const metadata = asObject(doc.metadata);
  const normalizedMailbox = String(metadata.mailbox ?? "").toLowerCase();
  const isSent = metadata.isSent === true;
  const isInbox = metadata.isInbox === true;
  const isDraft = metadata.isDraft === true;
  const isSpam = metadata.isSpam === true;
  const isTrash = metadata.isTrash === true;
  switch (mailbox) {
    case "sent":
      return normalizedMailbox === "sent" || isSent;
    case "inbox":
      return normalizedMailbox === "inbox" || isInbox;
    case "draft":
      return normalizedMailbox === "draft" || isDraft;
    case "spam":
      return normalizedMailbox === "spam" || isSpam;
    case "trash":
      return normalizedMailbox === "trash" || isTrash;
    case "archive":
      return normalizedMailbox === "archive";
    default:
      return true;
  }
}

function matchDateRange(doc: RankingDocument, request: UnifiedSearchRequest): boolean {
  const after = parseDate(request.dateRange?.after)?.getTime();
  const before = parseDate(request.dateRange?.before)?.getTime();
  if (!after && !before) return true;
  const timestamp = doc.timestamp ? Date.parse(doc.timestamp) : NaN;
  if (!Number.isFinite(timestamp)) return false;
  if (after && timestamp < after) return false;
  if (before) {
    const inclusiveBefore = before + DAY_MS - 1;
    if (timestamp > inclusiveBefore) return false;
  }
  return true;
}

function matchesRequest(doc: RankingDocument, request: UnifiedSearchRequest, mailbox: UnifiedSearchMailbox | undefined): boolean {
  if (!mailboxMatches(doc, mailbox)) return false;
  if (!matchDateRange(doc, request)) return false;

  const metadata = asObject(doc.metadata);
  const from = normalizeString(request.from);
  if (from && doc.surface === "email") {
    const sourceFrom = metadata.from ?? metadata.authorIdentity ?? doc.metadata?.authorIdentity ?? "";
    if (!includesNeedle(sourceFrom, from)) return false;
  }

  const to = normalizeString(request.to);
  if (to && doc.surface === "email") {
    const sourceTo = metadata.to ?? "";
    if (!includesNeedle(sourceTo, to)) return false;
  }

  const attendeeEmail = normalizeString(request.attendeeEmail);
  if (attendeeEmail && doc.surface === "calendar") {
    if (!includesNeedle(metadata.attendees, attendeeEmail)) return false;
  }

  return true;
}

async function searchIndexedSurface(params: {
  env: UnifiedSearchEnvironment;
  scopes: UnifiedSearchSurface[];
  queryVariants: string[];
  limit: number;
}): Promise<RankingDocument[]> {
  const docsById = new Map<string, RankingDocument>();
  const queryVariants = Array.from(new Set(params.queryVariants.map((value) => value.trim()).filter(Boolean)));
  const perVariantLimit = clampInt(params.limit * 4, 40, 1200);

  if (queryVariants.length > 0) {
    for (const query of queryVariants) {
      const rows = await searchIndexedDocuments({
        userId: params.env.userId,
        emailAccountId: params.env.emailAccountId,
        query,
        connectors: params.scopes,
        limit: perVariantLimit,
      });

      for (const row of rows) {
        const mapped = toSurfaceId(row);
        if (!mapped) continue;
        docsById.set(mapped.id, {
          id: mapped.id,
          surface: mapped.surface,
          title: row.title ?? "(Untitled)",
          snippet: (row.snippet ?? row.bodyText ?? "").slice(0, 500),
          timestamp: toIsoTimestamp(row.updatedSourceAt ?? row.occurredAt ?? row.startAt ?? undefined),
          metadata: {
            searchDocumentId: row.id,
            connector: row.connector,
            sourceType: row.sourceType,
            sourceId: row.sourceId,
            sourceParentId: row.sourceParentId,
            url: row.url,
            authorIdentity: row.authorIdentity,
            freshnessScore: row.freshnessScore ?? 0,
            authorityScore: row.authorityScore ?? 0,
            eventId: row.sourceId,
            start: toIsoTimestamp(row.startAt ?? undefined) ?? null,
            end: toIsoTimestamp(row.endAt ?? undefined) ?? null,
            ...(row.metadata ?? {}),
          },
        });
      }
    }
  }

  if (docsById.size === 0) {
    const fallbackRows = await listRecentIndexedDocuments({
      userId: params.env.userId,
      emailAccountId: params.env.emailAccountId,
      connectors: params.scopes,
      limit: clampInt(params.limit * 6, 30, 1500),
    });
    for (const row of fallbackRows) {
      const mapped = toSurfaceId(row);
      if (!mapped) continue;
      docsById.set(mapped.id, {
        id: mapped.id,
        surface: mapped.surface,
        title: row.title ?? "(Untitled)",
        snippet: (row.snippet ?? row.bodyText ?? "").slice(0, 500),
        timestamp: toIsoTimestamp(row.updatedSourceAt ?? row.occurredAt ?? row.startAt ?? undefined),
        metadata: {
          searchDocumentId: row.id,
          connector: row.connector,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          sourceParentId: row.sourceParentId,
          url: row.url,
          authorIdentity: row.authorIdentity,
          freshnessScore: row.freshnessScore ?? 0,
          authorityScore: row.authorityScore ?? 0,
          eventId: row.sourceId,
          start: toIsoTimestamp(row.startAt ?? undefined) ?? null,
          end: toIsoTimestamp(row.endAt ?? undefined) ?? null,
          ...(row.metadata ?? {}),
        },
      });
    }
  }

  return Array.from(docsById.values());
}

async function searchEmailProviderFallback(params: {
  env: UnifiedSearchEnvironment;
  request: UnifiedSearchRequest;
  query: string;
  mailbox: UnifiedSearchMailbox | undefined;
  limit: number;
}): Promise<RankingDocument[]> {
  if (!params.query.trim()) return [];

  const after = parseDate(params.request.dateRange?.after);
  const before = parseDate(params.request.dateRange?.before);
  const searchResult = await params.env.providers.email.search({
    query: params.query,
    text: params.request.text ?? params.query,
    from: params.request.from,
    to: params.request.to,
    sentByMe: params.mailbox === "sent" ? true : undefined,
    receivedByMe: params.mailbox === "inbox" ? true : undefined,
    before,
    after,
    limit: clampInt(Math.max(params.limit * 3, 60), 60, 300),
    fetchAll: Boolean(params.request.fetchAll),
  });
  const messages = Array.isArray(searchResult.messages)
    ? searchResult.messages
    : [];
  if (messages.length === 0) return [];

  const providerName =
    params.env.providers.email.name === "microsoft" ? "microsoft" : "google";

  await Promise.all(
    messages.map((message) =>
      enqueueEmailDocumentForIndexing({
        userId: params.env.userId,
        emailAccountId: params.env.emailAccountId,
        provider: providerName,
        message,
        logger: params.env.logger,
      }),
    ),
  );

  return messages.map((message) => {
    const timestamp = toIsoTimestamp(message.date as Date | string | undefined);
    const labelIds = Array.isArray(message.labelIds) ? message.labelIds : [];
    const isSent = labelIds.includes("SENT");
    const isInbox = labelIds.includes("INBOX");
    const isDraft = labelIds.includes("DRAFT");
    const isSpam = labelIds.includes("SPAM");
    const isTrash = labelIds.includes("TRASH");

    let mailbox = "all";
    if (isSent) mailbox = "sent";
    else if (isInbox) mailbox = "inbox";
    else if (isDraft) mailbox = "draft";
    else if (isSpam) mailbox = "spam";
    else if (isTrash) mailbox = "trash";

    return {
      id: `email:${message.id}`,
      surface: "email",
      title:
        message.subject ||
        message.headers?.subject ||
        "(No Subject)",
      snippet:
        message.snippet ||
        message.textPlain ||
        message.textHtml ||
        "",
      timestamp,
      metadata: {
        connector: "email",
        sourceType: "message",
        sourceId: message.id,
        sourceParentId: message.threadId,
        threadId: message.threadId,
        messageId: message.id,
        from: message.headers?.from ?? "",
        to: message.headers?.to ?? "",
        cc: message.headers?.cc ?? "",
        bcc: message.headers?.bcc ?? "",
        labelIds,
        mailbox,
        hasAttachment:
          Array.isArray(message.attachments) &&
          message.attachments.length > 0,
        attachmentCount: message.attachments?.length ?? 0,
        isSent,
        isInbox,
        isDraft,
        isSpam,
        isTrash,
        freshnessScore: computeFreshnessScore(timestamp),
        authorityScore: 0.5,
      },
    } satisfies RankingDocument;
  });
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
    ranking: entry.features,
    metadata: entry.doc.metadata,
  };
}

export interface UnifiedSearchService {
  query(request: UnifiedSearchRequest): Promise<UnifiedSearchResult>;
}

export function createUnifiedSearchService(env: UnifiedSearchEnvironment): UnifiedSearchService {
  return {
    async query(request) {
      const startedAt = Date.now();
      const limit = clampInt(request.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
      const queryPlan = await planUnifiedSearchQuery({
        userId: env.userId,
        emailAccountId: env.emailAccountId,
        request,
      });
      const scopes = normalizeSurfaceList(request.scopes ?? queryPlan.scopes);
      const mailbox = queryPlan.mailbox ?? request.mailbox;
      const rankingQuery = queryPlan.rewrittenQuery || normalizeString(request.query) || normalizeString(request.text);

      const indexedDocs = await searchIndexedSurface({
        env,
        scopes,
        queryVariants: queryPlan.queryVariants,
        limit,
      });
      const filteredIndexedDocs = indexedDocs.filter((doc) => matchesRequest(doc, request, mailbox));

      const indexedDocumentIds = filteredIndexedDocs
        .map((doc) => {
          const metadata = asObject(doc.metadata);
          const searchDocumentId = metadata.searchDocumentId;
          return typeof searchDocumentId === "string" ? searchDocumentId : undefined;
        })
        .filter((id): id is string => Boolean(id));

      const behaviorScores = new Map<string, number>();
      if (indexedDocumentIds.length > 0) {
        const scoreRows = await getSearchBehaviorScores({
          userId: env.userId,
          emailAccountId: env.emailAccountId,
          documentIds: indexedDocumentIds,
          days: 45,
        });
        for (const row of scoreRows) {
          behaviorScores.set(row.documentId, row.score);
        }
      }

      const docsById = new Map<string, RankingDocument>();
      for (const doc of filteredIndexedDocs) {
        const metadata = asObject(doc.metadata);
        const searchDocumentId =
          typeof metadata.searchDocumentId === "string" ? metadata.searchDocumentId : undefined;
        const behaviorScore =
          searchDocumentId && behaviorScores.has(searchDocumentId)
            ? behaviorScores.get(searchDocumentId)
            : undefined;
        const graphScore = computeGraphProximityScore(doc, [
          ...queryPlan.terms,
          ...queryPlan.aliasExpansions.map((value) => value.toLowerCase()),
        ]);

        docsById.set(doc.id, doc);
        doc.metadata = {
          ...metadata,
          behaviorScore: behaviorScore ?? 0,
          graphScore,
        };
      }

      const hasEmailCandidate = Array.from(docsById.values()).some(
        (doc) => doc.surface === "email",
      );
      const shouldRunEmailFallback =
        scopes.includes("email") &&
        !hasEmailCandidate &&
        rankingQuery.length > 0;

      if (shouldRunEmailFallback) {
        const fallbackDocs = await searchEmailProviderFallback({
          env,
          request,
          query: rankingQuery,
          mailbox,
          limit,
        });
        const filteredFallbackDocs = fallbackDocs.filter((doc) =>
          matchesRequest(doc, request, mailbox),
        );
        for (const doc of filteredFallbackDocs) {
          const metadata = asObject(doc.metadata);
          const graphScore = computeGraphProximityScore(doc, [
            ...queryPlan.terms,
            ...queryPlan.aliasExpansions.map((value) => value.toLowerCase()),
          ]);
          doc.metadata = {
            ...metadata,
            behaviorScore: 0,
            graphScore,
          };
          if (!docsById.has(doc.id)) {
            docsById.set(doc.id, doc);
          }
        }
      }

      const docs = Array.from(docsById.values());

      const ranked = await rankDocuments({
        query: rankingQuery,
        docs,
        intentHints: {
          requestedSurfaces: new Set(scopes),
          mailbox,
        },
      });

      const filteredRanked = rankingQuery
        ? ranked.filter((entry) => entry.score >= 0.1)
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

      const topSearchDocumentIds = top
        .map((item) => {
          const metadata = asObject(item.metadata);
          const id = metadata.searchDocumentId;
          return typeof id === "string" ? id : undefined;
        })
        .filter((id): id is string => Boolean(id));

      if (topSearchDocumentIds.length > 0) {
        void Promise.all([
          recordSearchSignals({
            userId: env.userId,
            emailAccountId: env.emailAccountId,
            signalType: "query_hit",
            signalValue: 1,
            documentIds: topSearchDocumentIds,
            metadata: {
              query: rankingQuery,
              scopes,
              mailbox: mailbox ?? null,
            },
          }),
          recordSearchSignals({
            userId: env.userId,
            emailAccountId: env.emailAccountId,
            signalType: "result_impression",
            signalValue: 1,
            documentIds: topSearchDocumentIds,
            metadata: {
              query: rankingQuery,
              scopes,
              mailbox: mailbox ?? null,
            },
          }),
        ]).catch((error) => {
          env.logger.warn("Failed to record unified search signals", {
            userId: env.userId,
            emailAccountId: env.emailAccountId,
            error,
          });
        });
      }

      env.logger.info("Unified search completed", {
        userId: env.userId,
        emailAccountId: env.emailAccountId,
        query: rankingQuery,
        scopes,
        mailbox,
        totalCandidates: docs.length,
        candidateCounts: {
          email: docs.filter((doc) => doc.surface === "email").length,
          calendar: docs.filter((doc) => doc.surface === "calendar").length,
          rule: docs.filter((doc) => doc.surface === "rule").length,
          memory: docs.filter((doc) => doc.surface === "memory").length,
        },
        totalRanked: total,
        topCount: top.length,
        zeroResult: top.length === 0,
        latencyMs: Date.now() - startedAt,
      });

      return {
        items: top,
        counts,
        total,
        truncated: total > limit,
        queryPlan: {
          query: queryPlan.query,
          rewrittenQuery: queryPlan.rewrittenQuery,
          queryVariants: queryPlan.queryVariants,
          scopes,
          mailbox,
          aliasExpansions: queryPlan.aliasExpansions,
        },
      };
    },
  };
}
