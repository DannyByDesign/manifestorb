import prisma from "@/server/db/client";
import {
  listRecentIndexedDocuments,
  searchIndexedDocuments,
} from "@/server/features/search/index/repository";
import { planUnifiedSearchQuery } from "@/server/features/search/unified/query";
import { rankDocuments } from "@/server/features/search/unified/ranking";
import { extractEmailAddresses } from "@/server/lib/email";
import type { CalendarEvent } from "@/server/features/calendar/event-types";
import type {
  RankingDocument,
  UnifiedSearchEnvironment,
  UnifiedSearchItem,
  UnifiedSearchMailbox,
  UnifiedSearchRequest,
  UnifiedSearchResult,
  UnifiedSearchSort,
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

function isDateOnlyValue(value: string | undefined): boolean {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/u.test(value.trim());
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

function toMemorySurfaceId(row: {
  connector: string;
  sourceType: string;
  sourceId: string;
}): { surface: "memory"; id: string } | null {
  if (row.connector !== "memory") return null;
  return { surface: "memory", id: `memory:${row.sourceType}:${row.sourceId}` };
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

function normalizeLabelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.toUpperCase() : ""))
    .filter((item) => item.length > 0);
}

function normalizeEmailCategory(category: unknown): string | undefined {
  const value = typeof category === "string" ? category.trim().toLowerCase() : "";
  if (!value) return undefined;
  switch (value) {
    case "primary":
      return "CATEGORY_PERSONAL";
    case "promotions":
      return "CATEGORY_PROMOTIONS";
    case "social":
      return "CATEGORY_SOCIAL";
    case "updates":
      return "CATEGORY_UPDATES";
    case "forums":
      return "CATEGORY_FORUMS";
    default:
      return undefined;
  }
}

function inferEmailUnreadState(metadata: Record<string, unknown>): boolean | undefined {
  if (typeof metadata.isUnread === "boolean") return metadata.isUnread;
  const labelIds = normalizeLabelIds(metadata.labelIds);
  if (labelIds.includes("UNREAD")) return true;
  if (labelIds.includes("READ")) return false;
  if (typeof metadata.isRead === "boolean") return !metadata.isRead;
  return undefined;
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
  const afterRaw = request.dateRange?.after;
  const beforeRaw = request.dateRange?.before;
  const after = parseDate(afterRaw)?.getTime();
  const beforeDate = parseDate(beforeRaw);
  if (!after && !beforeDate) return true;
  const timestamp = doc.timestamp ? Date.parse(doc.timestamp) : NaN;
  if (!Number.isFinite(timestamp)) return false;
  if (after && timestamp < after) return false;
  if (beforeDate) {
    const inclusiveBefore =
      beforeDate.getTime() + (isDateOnlyValue(beforeRaw) ? DAY_MS - 1 : 0);
    if (timestamp > inclusiveBefore) return false;
  }
  return true;
}

function matchesRequest(
  doc: RankingDocument,
  request: UnifiedSearchRequest,
  mailbox: UnifiedSearchMailbox | undefined,
): boolean {
  if (!mailboxMatches(doc, mailbox)) return false;
  if (!matchDateRange(doc, request)) return false;

  const metadata = asObject(doc.metadata);
  if (doc.surface === "email") {
    if (typeof request.unread === "boolean") {
      const unread = inferEmailUnreadState(metadata);
      if (unread !== request.unread) return false;
    }
    if (typeof request.hasAttachment === "boolean") {
      const hasAttachment = metadata.hasAttachment === true;
      if (hasAttachment !== request.hasAttachment) return false;
    }
    const ccNeedle = normalizeString(request.cc);
    if (ccNeedle) {
      const sourceCc = metadata.cc ?? "";
      if (!includesNeedle(sourceCc, ccNeedle)) return false;
    }

    const normalizeList = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.map((v) => String(v).trim().toLowerCase()).filter(Boolean)
        : [];

    const matchesAnyEmail = (headerValue: unknown, wanted: string[]): boolean => {
      if (wanted.length === 0) return true;
      const emails = extractEmailAddresses(String(headerValue ?? "")).map((e) => e.toLowerCase());
      if (emails.length === 0) return false;
      const set = new Set(emails);
      return wanted.some((w) => set.has(w));
    };

    const matchesAnyDomain = (headerValue: unknown, wantedDomains: string[]): boolean => {
      if (wantedDomains.length === 0) return true;
      const emails = extractEmailAddresses(String(headerValue ?? "")).map((e) => e.toLowerCase());
      if (emails.length === 0) return false;
      const domains = emails
        .map((email) => email.split("@")[1] ?? "")
        .filter((d) => d.length > 0);
      if (domains.length === 0) return false;
      return wantedDomains.some((needleRaw) => {
        const needle = needleRaw.replace(/^@/u, "").toLowerCase();
        if (!needle) return false;
        return domains.some((d) => d === needle || d.endsWith(`.${needle}`));
      });
    };

    const fromEmails = normalizeList(request.fromEmails);
    const fromDomains = normalizeList(request.fromDomains);
    const fromHeader = metadata.from ?? metadata.authorIdentity ?? "";
    if (!matchesAnyEmail(fromHeader, fromEmails)) return false;
    if (!matchesAnyDomain(fromHeader, fromDomains)) return false;

    const toEmails = normalizeList(request.toEmails);
    const toDomains = normalizeList(request.toDomains);
    const toHeader = metadata.to ?? "";
    if (!matchesAnyEmail(toHeader, toEmails)) return false;
    if (!matchesAnyDomain(toHeader, toDomains)) return false;

    const ccEmails = normalizeList(request.ccEmails);
    const ccDomains = normalizeList(request.ccDomains);
    const ccHeader = metadata.cc ?? "";
    if (!matchesAnyEmail(ccHeader, ccEmails)) return false;
    if (!matchesAnyDomain(ccHeader, ccDomains)) return false;

    const categoryLabel = normalizeEmailCategory(request.category);
    if (categoryLabel) {
      const labelIds = normalizeLabelIds(metadata.labelIds);
      if (!labelIds.includes(categoryLabel)) return false;
    }

    const mimeTypes = Array.isArray(request.attachmentMimeTypes)
      ? request.attachmentMimeTypes.map((value) => String(value).toLowerCase())
      : [];
    if (mimeTypes.length > 0) {
      const available = Array.isArray(metadata.attachmentMimeTypes)
        ? metadata.attachmentMimeTypes.map((value) => String(value).toLowerCase())
        : [];
      if (available.length === 0) return false;
      if (!mimeTypes.some((needle) => available.some((mt) => mt.includes(needle)))) {
        return false;
      }
    }

    const filenameNeedle = normalizeString(request.attachmentFilenameContains);
    if (filenameNeedle) {
      const names = Array.isArray(metadata.attachmentNames)
        ? metadata.attachmentNames.map((value) => String(value))
        : [];
      if (names.length === 0) return false;
      if (!names.some((name) => includesNeedle(name, filenameNeedle))) return false;
    }
  }

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

  if (doc.surface === "calendar") {
    const calendarIds = Array.isArray(request.calendarIds)
      ? request.calendarIds.map((id) => String(id))
      : [];
    if (calendarIds.length > 0) {
      const docCalendarId = typeof metadata.calendarId === "string" ? metadata.calendarId : "";
      if (!calendarIds.includes(docCalendarId)) return false;
    }

    const locationNeedle = normalizeString(request.locationContains);
    if (locationNeedle) {
      const location = typeof metadata.location === "string" ? metadata.location : "";
      if (!includesNeedle(location, locationNeedle)) return false;
    }
  }

  return true;
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

function resolveSort(params: {
  requestSort: UnifiedSearchSort | undefined;
  plannedSort: UnifiedSearchSort | undefined;
  scopes: UnifiedSearchSurface[];
  mailbox: UnifiedSearchMailbox | undefined;
  request: UnifiedSearchRequest;
}): UnifiedSearchSort {
  if (params.requestSort) return params.requestSort;
  if (params.plannedSort) return params.plannedSort;

  const isEmailOnlyScope =
    params.scopes.length === 1 && params.scopes[0] === "email";
  if (!isEmailOnlyScope) return "relevance";

  if (params.mailbox && params.mailbox !== "all") return "newest";

  const hasEmailRetrievalConstraint = Boolean(
    typeof params.request.unread === "boolean" ||
      typeof params.request.hasAttachment === "boolean" ||
      params.request.from ||
      params.request.to ||
      params.request.cc ||
      params.request.fromEmails?.length ||
      params.request.fromDomains?.length ||
      params.request.toEmails?.length ||
      params.request.toDomains?.length ||
      params.request.ccEmails?.length ||
      params.request.ccDomains?.length ||
      params.request.category ||
      params.request.attachmentMimeTypes?.length ||
      params.request.attachmentFilenameContains ||
      params.request.dateRange,
  );
  if (hasEmailRetrievalConstraint) return "newest";

  return "relevance";
}

function sortRankedEntries(
  entries: Awaited<ReturnType<typeof rankDocuments>>,
  sort: UnifiedSearchSort,
): Awaited<ReturnType<typeof rankDocuments>> {
  if (sort === "relevance") return entries;
  const direction = sort === "newest" ? -1 : 1;
  return [...entries].sort((a, b) => {
    const aTs = a.doc.timestamp ? Date.parse(a.doc.timestamp) : NaN;
    const bTs = b.doc.timestamp ? Date.parse(b.doc.timestamp) : NaN;
    const aFinite = Number.isFinite(aTs);
    const bFinite = Number.isFinite(bTs);
    if (aFinite && bFinite && aTs !== bTs) {
      return direction * (aTs - bTs);
    }
    if (aFinite !== bFinite) {
      return aFinite ? -1 : 1;
    }
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) > 1e-6) return scoreDiff;
    return a.doc.id.localeCompare(b.doc.id);
  });
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function buildEmailProviderQuery(params: {
  query: string;
  request: UnifiedSearchRequest;
  mailbox: UnifiedSearchMailbox | undefined;
}): string {
  const parts = [params.query.trim()];
  if (params.mailbox && params.mailbox !== "all") {
    parts.push(`in:${params.mailbox}`);
  }
  if (params.request.unread === true) parts.push("is:unread");
  if (params.request.unread === false) parts.push("is:read");
  if (params.request.hasAttachment === true) parts.push("has:attachment");
  if (params.request.category) parts.push(`category:${params.request.category}`);
  return dedupeStrings(parts).join(" ").trim();
}

function shouldIncludeNonPrimary(request: UnifiedSearchRequest, mailbox: UnifiedSearchMailbox | undefined): boolean {
  if (mailbox === "all") return true;
  if (mailbox && mailbox !== "inbox") return true;
  if (request.category && request.category !== "primary") return true;
  return false;
}

function toEmailDocument(message: {
  id: string;
  threadId: string;
  date?: Date | string;
  snippet?: string;
  textPlain?: string;
  textHtml?: string;
  subject?: string;
  headers?: {
    from?: string;
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
  };
  labelIds?: string[];
  attachments?: Array<{
    mimeType?: string;
    filename?: string;
    name?: string;
  }>;
}): RankingDocument {
  const timestamp = toIsoTimestamp(message.date);
  const labelIds = Array.isArray(message.labelIds) ? message.labelIds : [];
  const isSent = labelIds.includes("SENT");
  const isInbox = labelIds.includes("INBOX");
  const isDraft = labelIds.includes("DRAFT");
  const isSpam = labelIds.includes("SPAM");
  const isTrash = labelIds.includes("TRASH");
  const isUnread = labelIds.includes("UNREAD");

  let mailbox = "all";
  if (isSent) mailbox = "sent";
  else if (isInbox) mailbox = "inbox";
  else if (isDraft) mailbox = "draft";
  else if (isSpam) mailbox = "spam";
  else if (isTrash) mailbox = "trash";

  const attachmentMimeTypes = (message.attachments ?? [])
    .map((attachment) => attachment.mimeType?.trim())
    .filter((value): value is string => Boolean(value));
  const attachmentNames = (message.attachments ?? [])
    .map((attachment) => attachment.filename?.trim() || attachment.name?.trim())
    .filter((value): value is string => Boolean(value));

  return {
    id: `email:${message.id}`,
    surface: "email",
    title: message.subject || message.headers?.subject || "(No Subject)",
    snippet: message.snippet || message.textPlain || message.textHtml || "",
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
      hasAttachment: Array.isArray(message.attachments) && message.attachments.length > 0,
      attachmentCount: message.attachments?.length ?? 0,
      attachmentMimeTypes,
      attachmentNames,
      isSent,
      isInbox,
      isDraft,
      isSpam,
      isTrash,
      isUnread,
      freshnessScore: computeFreshnessScore(timestamp),
      authorityScore: 0.5,
    },
  };
}

async function searchEmailSurface(params: {
  env: UnifiedSearchEnvironment;
  request: UnifiedSearchRequest;
  queryPlan: {
    queryVariants: string[];
    rewrittenQuery: string;
  };
  rankingQuery: string;
  mailbox: UnifiedSearchMailbox | undefined;
  limit: number;
}): Promise<RankingDocument[]> {
  const before = parseDate(params.request.dateRange?.before);
  const after = parseDate(params.request.dateRange?.after);
  const includeNonPrimary = shouldIncludeNonPrimary(params.request, params.mailbox);
  const providerLimit = clampInt(Math.max(params.limit * 3, 60), 20, 500);
  const queries = dedupeStrings([
    params.rankingQuery,
    ...params.queryPlan.queryVariants,
    params.queryPlan.rewrittenQuery,
  ]);
  const effectiveQueries = queries.length > 0 ? queries : [""];

  const docsById = new Map<string, RankingDocument>();
  for (const query of effectiveQueries) {
    const providerQuery = buildEmailProviderQuery({
      query,
      request: params.request,
      mailbox: params.mailbox,
    });
    const result = await params.env.providers.email.search({
      query: providerQuery,
      text: params.request.text ?? providerQuery,
      from: params.request.from,
      to: params.request.to,
      cc: params.request.cc,
      fromEmails: params.request.fromEmails,
      fromDomains: params.request.fromDomains,
      toEmails: params.request.toEmails,
      toDomains: params.request.toDomains,
      ccEmails: params.request.ccEmails,
      ccDomains: params.request.ccDomains,
      category: params.request.category,
      hasAttachment: params.request.hasAttachment,
      attachmentMimeTypes: params.request.attachmentMimeTypes,
      attachmentFilenameContains: params.request.attachmentFilenameContains,
      sentByMe: params.mailbox === "sent" ? true : undefined,
      receivedByMe: params.mailbox === "inbox" ? true : undefined,
      before,
      after,
      includeNonPrimary,
      limit: providerLimit,
      fetchAll: Boolean(params.request.fetchAll),
    });
    const messages = Array.isArray(result.messages) ? result.messages : [];
    for (const message of messages) {
      docsById.set(`email:${message.id}`, toEmailDocument(message));
    }
    if (docsById.size >= providerLimit) break;
  }

  return Array.from(docsById.values());
}

function resolveCalendarRange(request: UnifiedSearchRequest): { start: Date; end: Date } {
  const now = new Date();
  const after = parseDate(request.dateRange?.after);
  const before = parseDate(request.dateRange?.before);
  const start = after ?? new Date(now.getTime() - 180 * DAY_MS);
  const end = before ?? new Date(now.getTime() + 365 * DAY_MS);
  if (start.getTime() <= end.getTime()) {
    return { start, end };
  }
  return { start: end, end: start };
}

function toCalendarDocument(event: CalendarEvent): RankingDocument {
  const timestamp = toIsoTimestamp(event.startTime);
  return {
    id: `calendar:${event.id}`,
    surface: "calendar",
    title: event.title || "(Untitled Event)",
    snippet: [event.description, event.location].filter(Boolean).join("\n"),
    timestamp,
    metadata: {
      connector: "calendar",
      sourceType: "event",
      sourceId: event.id,
      eventId: event.id,
      calendarId: event.calendarId,
      provider: event.provider,
      iCalUid: event.iCalUid,
      location: event.location,
      attendees: (event.attendees ?? []).map((attendee) => attendee.email),
      organizerEmail: event.organizerEmail,
      start: toIsoTimestamp(event.startTime) ?? null,
      end: toIsoTimestamp(event.endTime) ?? null,
      freshnessScore: computeFreshnessScore(timestamp),
      authorityScore: 0.45,
    },
  };
}

async function searchCalendarSurface(params: {
  env: UnifiedSearchEnvironment;
  request: UnifiedSearchRequest;
  rankingQuery: string;
  limit: number;
}): Promise<RankingDocument[]> {
  const range = resolveCalendarRange(params.request);
  const events = await params.env.providers.calendar.searchEvents(
    params.rankingQuery,
    range,
    params.request.attendeeEmail,
  );

  const docsById = new Map<string, RankingDocument>();
  for (const event of events) {
    docsById.set(`calendar:${event.id}`, toCalendarDocument(event));
    if (docsById.size >= clampInt(params.limit * 4, 50, 1200)) break;
  }
  return Array.from(docsById.values());
}

async function searchRuleSurface(params: {
  userId: string;
  emailAccountId: string;
  limit: number;
}): Promise<RankingDocument[]> {
  const rows = await prisma.canonicalRule.findMany({
    where: {
      userId: params.userId,
      OR: [{ emailAccountId: params.emailAccountId }, { emailAccountId: null }],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: clampInt(params.limit * 8, 40, 1000),
    select: {
      id: true,
      type: true,
      enabled: true,
      priority: true,
      name: true,
      description: true,
      sourceNl: true,
      sourceMode: true,
      sourceMessageId: true,
      sourceConversationId: true,
      updatedAt: true,
      match: true,
      actionPlan: true,
      trigger: true,
      decision: true,
      expiresAt: true,
      disabledUntil: true,
    },
  });

  return rows.map((row) => {
    const summaryText = [
      row.description,
      row.sourceNl,
      typeof row.decision === "string" ? row.decision : "",
      JSON.stringify(row.match ?? {}),
      JSON.stringify(row.actionPlan ?? {}),
      JSON.stringify(row.trigger ?? {}),
    ]
      .filter(Boolean)
      .join("\n");

    return {
      id: `rule:${row.id}`,
      surface: "rule",
      title: row.name?.trim() || row.description?.trim() || `Rule ${row.id}`,
      snippet: summaryText,
      timestamp: toIsoTimestamp(row.updatedAt),
      metadata: {
        connector: "rule",
        sourceType: "canonical_rule",
        sourceId: row.id,
        ruleId: row.id,
        type: row.type,
        enabled: row.enabled,
        priority: row.priority,
        sourceMode: row.sourceMode,
        sourceMessageId: row.sourceMessageId,
        sourceConversationId: row.sourceConversationId,
        expiresAt: toIsoTimestamp(row.expiresAt),
        disabledUntil: toIsoTimestamp(row.disabledUntil),
        freshnessScore: computeFreshnessScore(toIsoTimestamp(row.updatedAt)),
        authorityScore: row.enabled ? 0.55 : 0.35,
      },
    } satisfies RankingDocument;
  });
}

async function searchMemorySurface(params: {
  env: UnifiedSearchEnvironment;
  queryVariants: string[];
  limit: number;
}): Promise<RankingDocument[]> {
  const docsById = new Map<string, RankingDocument>();
  const queryVariants = dedupeStrings(params.queryVariants);
  const perVariantLimit = clampInt(params.limit * 4, 40, 1200);

  if (queryVariants.length > 0) {
    for (const query of queryVariants) {
      const rows = await searchIndexedDocuments({
        userId: params.env.userId,
        emailAccountId: params.env.emailAccountId,
        query,
        connectors: ["memory"],
        limit: perVariantLimit,
      });

      for (const row of rows) {
        const mapped = toMemorySurfaceId(row);
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
      connectors: ["memory"],
      limit: clampInt(params.limit * 6, 30, 1500),
    });
    for (const row of fallbackRows) {
      const mapped = toMemorySurfaceId(row);
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
          ...(row.metadata ?? {}),
        },
      });
    }
  }

  return Array.from(docsById.values());
}

export interface UnifiedSearchService {
  query(request: UnifiedSearchRequest): Promise<UnifiedSearchResult>;
}

export function createUnifiedSearchService(env: UnifiedSearchEnvironment): UnifiedSearchService {
  return {
    async query(request) {
      const startedAt = Date.now();
      const queryPlan = await planUnifiedSearchQuery({
        userId: env.userId,
        emailAccountId: env.emailAccountId,
        email: env.email,
        request,
      });
      const effectiveRequest: UnifiedSearchRequest = {
        ...request,
        scopes: request.scopes ?? queryPlan.scopes,
        mailbox: request.mailbox ?? queryPlan.mailbox,
        sort: request.sort ?? queryPlan.sort,
        unread:
          typeof request.unread === "boolean"
            ? request.unread
            : queryPlan.unread,
        hasAttachment:
          typeof request.hasAttachment === "boolean"
            ? request.hasAttachment
            : queryPlan.hasAttachment,
        category: request.category ?? queryPlan.category,
        dateRange: request.dateRange ?? queryPlan.dateRange,
        limit: request.limit ?? queryPlan.inferredLimit,
      };

      const limit = clampInt(
        effectiveRequest.limit ?? DEFAULT_LIMIT,
        1,
        MAX_LIMIT,
      );
      const scopes = normalizeSurfaceList(effectiveRequest.scopes);
      const mailbox = effectiveRequest.mailbox;
      const sort = resolveSort({
        requestSort: effectiveRequest.sort,
        plannedSort: queryPlan.sort,
        scopes,
        mailbox,
        request: effectiveRequest,
      });
      const rankingQuery =
        queryPlan.rewrittenQuery ||
        normalizeString(request.query) ||
        normalizeString(request.text);

      if (queryPlan.needsClarification) {
        return {
          items: [],
          counts: {
            email: 0,
            calendar: 0,
            rule: 0,
            memory: 0,
          },
          total: 0,
          truncated: false,
          queryPlan: {
            query: queryPlan.query,
            rewrittenQuery: queryPlan.rewrittenQuery,
            queryVariants: queryPlan.queryVariants,
            scopes,
            mailbox,
            mailboxExplicit: queryPlan.mailboxExplicit,
            sort,
            unread: effectiveRequest.unread,
            hasAttachment: effectiveRequest.hasAttachment,
            category: effectiveRequest.category,
            categoryExplicit: queryPlan.categoryExplicit,
            dateRange: effectiveRequest.dateRange,
            inferredLimit: queryPlan.inferredLimit,
            needsClarification: true,
            clarificationPrompt: queryPlan.clarificationPrompt,
            aliasExpansions: queryPlan.aliasExpansions,
          },
        };
      }

      const docsById = new Map<string, RankingDocument>();

      if (scopes.includes("email")) {
        const emailDocs = await searchEmailSurface({
          env,
          request: effectiveRequest,
          queryPlan,
          rankingQuery,
          mailbox,
          limit,
        });
        for (const doc of emailDocs) docsById.set(doc.id, doc);
      }

      if (scopes.includes("calendar")) {
        const calendarDocs = await searchCalendarSurface({
          env,
          request: effectiveRequest,
          rankingQuery,
          limit,
        });
        for (const doc of calendarDocs) docsById.set(doc.id, doc);
      }

      if (scopes.includes("rule")) {
        const ruleDocs = await searchRuleSurface({
          userId: env.userId,
          emailAccountId: env.emailAccountId,
          limit,
        });
        for (const doc of ruleDocs) docsById.set(doc.id, doc);
      }

      if (scopes.includes("memory")) {
        const memoryDocs = await searchMemorySurface({
          env,
          queryVariants: queryPlan.queryVariants,
          limit,
        });
        for (const doc of memoryDocs) docsById.set(doc.id, doc);
      }

      const docs = Array.from(docsById.values())
        .filter((doc) => matchesRequest(doc, effectiveRequest, mailbox))
        .map((doc) => {
          const metadata = asObject(doc.metadata);
          const graphScore = computeGraphProximityScore(doc, [
            ...queryPlan.terms,
            ...queryPlan.aliasExpansions.map((value) => value.toLowerCase()),
          ]);
          return {
            ...doc,
            metadata: {
              ...metadata,
              behaviorScore: metadata.behaviorScore ?? 0,
              graphScore,
            },
          } satisfies RankingDocument;
        });

      const ranked = await rankDocuments({
        query: rankingQuery,
        docs,
        intentHints: {
          requestedSurfaces: new Set(scopes),
          mailbox,
          sort,
        },
      });

      const rankedBySort = sortRankedEntries(ranked, sort);
      const filteredRanked =
        sort === "relevance" && rankingQuery
          ? rankedBySort.filter((entry) => entry.score >= 0.1)
          : rankedBySort;

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

      env.logger.info("Unified search completed", {
        userId: env.userId,
        emailAccountId: env.emailAccountId,
        query: rankingQuery,
        scopes,
        mailbox,
        sort,
        unread: effectiveRequest.unread ?? null,
        hasAttachment: effectiveRequest.hasAttachment ?? null,
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
          mailboxExplicit: queryPlan.mailboxExplicit,
          sort,
          unread: effectiveRequest.unread,
          hasAttachment: effectiveRequest.hasAttachment,
          category: effectiveRequest.category,
          categoryExplicit: queryPlan.categoryExplicit,
          dateRange: effectiveRequest.dateRange,
          inferredLimit: queryPlan.inferredLimit,
          needsClarification: queryPlan.needsClarification,
          clarificationPrompt: queryPlan.clarificationPrompt,
          aliasExpansions: queryPlan.aliasExpansions,
        },
      };
    },
  };
}
