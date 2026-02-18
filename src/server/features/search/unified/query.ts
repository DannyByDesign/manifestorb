import { lookupSearchAliasExpansions } from "@/server/features/search/index/repository";
import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { toZonedTime } from "date-fns-tz";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
import type {
  UnifiedSearchMailbox,
  UnifiedSearchDateRange,
  UnifiedSearchEmailCategory,
  UnifiedSearchRequest,
  UnifiedSearchSort,
  UnifiedSearchSurface,
} from "@/server/features/search/unified/types";

const DEFAULT_SURFACES: UnifiedSearchSurface[] = ["email", "calendar", "rule", "memory"];

const semanticQueryCompilerSchema = z
  .object({
    rewrittenQuery: z.string().max(500).optional(),
    scopes: z
      .array(z.enum(["email", "calendar", "rule", "memory"]))
      .max(4)
      .optional(),
    mailbox: z
      .enum(["inbox", "sent", "draft", "trash", "spam", "archive", "all"])
      .optional(),
    sort: z.enum(["relevance", "newest", "oldest"]).optional(),
    unread: z.boolean().optional(),
    hasAttachment: z.boolean().optional(),
    category: z.enum(["primary", "promotions", "social", "updates", "forums"]).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    needsClarification: z.boolean().optional(),
    clarificationPrompt: z.string().max(240).optional(),
  })
  .strict();

function shouldUseSemanticQueryCompiler(): boolean {
  if (process.env.UNIFIED_SEARCH_QUERY_COMPILER_FORCE_MODEL === "true") return true;
  if (process.env.UNIFIED_SEARCH_QUERY_COMPILER_USE_MODEL === "false") return false;
  return true;
}

async function compileSemanticQueryIntent(params: {
  userId: string;
  emailAccountId?: string;
  email?: string;
  query: string;
}): Promise<z.infer<typeof semanticQueryCompilerSchema> | null> {
  if (!shouldUseSemanticQueryCompiler()) return null;
  if (!params.query.trim()) return null;
  if (!params.emailAccountId || !params.email) return null;

  const modelOptions = getModel("economy");
  const generate = createGenerateObject({
    emailAccount: {
      id: params.emailAccountId,
      email: params.email,
      userId: params.userId,
    },
    label: "unified-search-query-compiler",
    modelOptions,
    maxLLMRetries: 2,
  });

  const run = generate({
    model: modelOptions.model,
    schema: semanticQueryCompilerSchema,
    system: [
      "You normalize natural-language search intents into structured retrieval constraints.",
      "Preserve user intent across inbox/calendar/rules/memory search.",
      "Return only constraints that are explicit or strongly implied by the query.",
      "Use sort=newest for latest/recent phrasing and sort=oldest for oldest/earliest phrasing.",
      "Set unread only when query clearly asks for unread/read.",
      "Set hasAttachment only when attachment intent is explicit.",
      "Set rewrittenQuery to semantic content terms only. Omit operational words (e.g. unread/latest/show/list).",
      "If request is purely operational (e.g. '10 most recent unread emails'), rewrittenQuery should be empty or omitted.",
      "If intent is ambiguous or underspecified, set needsClarification=true and provide a short clarificationPrompt.",
      "Do not hallucinate people, dates, or mailbox scopes.",
    ].join("\n"),
    prompt: [
      `Current UTC date: ${new Date().toISOString().slice(0, 10)}`,
      `Search query: ${params.query}`,
    ].join("\n"),
  });

  const timeoutMs = Math.min(
    Math.max(
      Number.parseInt(
        process.env.UNIFIED_SEARCH_QUERY_COMPILER_TIMEOUT_MS ?? "2200",
        10,
      ) || 2200,
      1200,
    ),
    7_500,
  );

  try {
    const result = await Promise.race([
      run,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!result) return null;
    return semanticQueryCompilerSchema.parse(result.object);
  } catch {
    return null;
  }
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9@._:-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function dedupe(values: string[]): string[] {
  const set = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    set.add(normalized);
  }
  return [...set];
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatLocalYmd(localDate: Date): string {
  return `${localDate.getFullYear()}-${pad2(localDate.getMonth() + 1)}-${pad2(localDate.getDate())}`;
}

function startOfLocalDay(localDate: Date): Date {
  const out = new Date(localDate);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addLocalDays(localDate: Date, days: number): Date {
  const out = new Date(localDate);
  out.setDate(out.getDate() + days);
  return out;
}

function monthBounds(localDate: Date): { start: Date; end: Date } {
  const start = new Date(localDate.getFullYear(), localDate.getMonth(), 1);
  const end = new Date(localDate.getFullYear(), localDate.getMonth() + 1, 0);
  return { start, end };
}

function lastMonthBounds(localDate: Date): { start: Date; end: Date } {
  const start = new Date(localDate.getFullYear(), localDate.getMonth() - 1, 1);
  const end = new Date(localDate.getFullYear(), localDate.getMonth(), 0);
  return { start, end };
}

function inferDateRangeFromQuery(query: string, timeZone: string): UnifiedSearchDateRange | undefined {
  const normalized = query.toLowerCase();
  const nowLocal = toZonedTime(new Date(), timeZone);
  const today = startOfLocalDay(nowLocal);

  if (/\blast\s+7\s+days\b/u.test(normalized)) {
    const start = addLocalDays(today, -6);
    return { after: formatLocalYmd(start), before: formatLocalYmd(today) };
  }

  const lastDaysMatch = normalized.match(/\b(?:last|past)\s+(\d{1,3})\s+days?\b/u);
  if (lastDaysMatch) {
    const days = Number.parseInt(lastDaysMatch[1] ?? "", 10);
    if (Number.isFinite(days) && days > 0 && days <= 365) {
      const start = addLocalDays(today, -(days - 1));
      return { after: formatLocalYmd(start), before: formatLocalYmd(today) };
    }
  }

  if (/\byesterday\b/u.test(normalized)) {
    const day = addLocalDays(today, -1);
    const ymd = formatLocalYmd(day);
    return { after: ymd, before: ymd };
  }

  if (/\btoday|tonight\b/u.test(normalized)) {
    const ymd = formatLocalYmd(today);
    return { after: ymd, before: ymd };
  }

  if (/\btomorrow\b/u.test(normalized)) {
    const day = addLocalDays(today, 1);
    const ymd = formatLocalYmd(day);
    return { after: ymd, before: ymd };
  }

  if (/\bthis month\b/u.test(normalized)) {
    const { start, end } = monthBounds(today);
    return { after: formatLocalYmd(start), before: formatLocalYmd(end) };
  }

  if (/\blast month\b/u.test(normalized)) {
    const { start, end } = lastMonthBounds(today);
    return { after: formatLocalYmd(start), before: formatLocalYmd(end) };
  }

  if (/\bthis week\b/u.test(normalized)) {
    const dayOfWeek = today.getDay();
    const end = addLocalDays(today, 6 - dayOfWeek);
    return { after: formatLocalYmd(today), before: formatLocalYmd(end) };
  }

  if (/\bnext week\b/u.test(normalized)) {
    const dayOfWeek = today.getDay();
    const daysUntilNextMonday = ((8 - dayOfWeek) % 7) || 7;
    const start = addLocalDays(today, daysUntilNextMonday);
    const end = addLocalDays(start, 6);
    return { after: formatLocalYmd(start), before: formatLocalYmd(end) };
  }

  // Calendar-style "next event" semantics: clamp to future.
  if (/\bnext\b/u.test(normalized)) {
    // We only enforce after=now if query explicitly asks for "next" and not "next week" (handled above).
    return { after: new Date().toISOString() };
  }

  return undefined;
}

function inferSortFromQuery(query: string): UnifiedSearchSort | undefined {
  const q = query.toLowerCase();
  if (/\b(oldest|earliest|first)\b/u.test(q)) return "oldest";
  if (/\b(newest|latest|most recent|recent)\b/u.test(q)) return "newest";
  if (/\bnext\b/u.test(q)) return "oldest";
  return undefined;
}

function inferUnreadFromQuery(query: string): boolean | undefined {
  const q = query.toLowerCase();
  if (/\bunread\b/u.test(q)) return true;
  if (/\bread\b/u.test(q) && !/\bunread\b/u.test(q)) return false;
  return undefined;
}

function inferHasAttachmentFromQuery(query: string): boolean | undefined {
  const q = query.toLowerCase();
  if (/\bwith\s+attachments?\b|\bhas\s+attachments?\b|\bcontaining\s+attachments?\b/u.test(q)) {
    return true;
  }
  if (/\bno\s+attachments?\b|\bwithout\s+attachments?\b/u.test(q)) return false;
  if (/\battachments?\b/u.test(q)) return true;
  return undefined;
}

function inferCategoryFromQuery(query: string): UnifiedSearchEmailCategory | undefined {
  const q = query.toLowerCase();
  if (/\bpromotions?\b/u.test(q)) return "promotions";
  if (/\bsocial\b/u.test(q)) return "social";
  if (/\bupdates\b/u.test(q)) return "updates";
  if (/\bforums\b/u.test(q)) return "forums";
  if (/\bprimary\b/u.test(q)) return "primary";
  return undefined;
}

function inferMailboxFromQuery(query: string): UnifiedSearchMailbox | undefined {
  const q = query.toLowerCase();
  if (/\bsent\b/u.test(q)) return "sent";
  if (/\bdrafts?\b/u.test(q)) return "draft";
  if (/\bspam\b|\bjunk\b/u.test(q)) return "spam";
  if (/\btrash\b|\bdeleted\b/u.test(q)) return "trash";
  if (/\barchive\b/u.test(q)) return "archive";
  if (/\binbox\b/u.test(q)) return "inbox";
  return undefined;
}

function inferExplicitScopesFromQuery(query: string): UnifiedSearchSurface[] | undefined {
  // Only treat scopes as "explicit" when the user clearly names the surface(s),
  // not when they use domain words like "meeting" (which could appear in email too).
  const q = query.toLowerCase();
  const scopes: UnifiedSearchSurface[] = [];

  const mentionsEmail =
    /\b(my\s+)?(inbox|email|emails|mail|sent)\b/u.test(q) ||
    /\bin:(inbox|sent|drafts?|spam|trash|archive)\b/u.test(q);
  const mentionsCalendar = /\b(my\s+)?calendar\b/u.test(q) || /\b(events?)\b/u.test(q) && /\bmy\s+calendar\b/u.test(q);
  const mentionsRules = /\b(my\s+)?(rules?|policy|guardrails?|automation)\b/u.test(q);
  const mentionsMemory = /\b(my\s+)?memory\b/u.test(q);

  if (mentionsEmail) scopes.push("email");
  if (mentionsCalendar) scopes.push("calendar");
  if (mentionsRules) scopes.push("rule");
  if (mentionsMemory) scopes.push("memory");

  return scopes.length > 0 ? Array.from(new Set(scopes)) : undefined;
}

function inferLimitFromQuery(query: string): number | undefined {
  const match = query.toLowerCase().match(/\b(?:top|first|last|show|list)\s+(\d{1,3})\b/u);
  if (!match) return undefined;
  const value = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return clampInt(value, 1, 200);
}

export interface PlannedUnifiedSearchQuery {
  query: string;
  rewrittenQuery: string;
  queryVariants: string[];
  scopes: UnifiedSearchSurface[];
  mailbox?: UnifiedSearchMailbox;
  sort?: UnifiedSearchSort;
  unread?: boolean;
  hasAttachment?: boolean;
  category?: UnifiedSearchEmailCategory;
  dateRange?: UnifiedSearchDateRange;
  inferredLimit?: number;
  needsClarification?: boolean;
  clarificationPrompt?: string;
  aliasExpansions: string[];
  terms: string[];
}

export async function planUnifiedSearchQuery(params: {
  userId: string;
  emailAccountId?: string;
  email?: string;
  request: UnifiedSearchRequest;
}): Promise<PlannedUnifiedSearchQuery> {
  const baseQuery = normalize(params.request.query) || normalize(params.request.text);
  const emailAccountId = params.emailAccountId;

  const timeZone = (() => {
    const explicit = params.request.dateRange?.timeZone?.trim();
    if (explicit) return explicit;
    return null;
  })();
  const resolvedTimeZone = timeZone
    ? timeZone
    : emailAccountId
      ? await (async () => {
          const resolved = await resolveDefaultCalendarTimeZone({
            userId: params.userId,
            emailAccountId,
          });
          return "error" in resolved ? "UTC" : resolved.timeZone;
        })()
      : "UTC";

  const inferredDateRange =
    params.request.dateRange ?? (baseQuery ? inferDateRangeFromQuery(baseQuery, resolvedTimeZone) : undefined);

  const deterministic = baseQuery
    ? {
        sort: inferSortFromQuery(baseQuery),
        unread: inferUnreadFromQuery(baseQuery),
        hasAttachment: inferHasAttachmentFromQuery(baseQuery),
        limit: inferLimitFromQuery(baseQuery),
        mailbox: inferMailboxFromQuery(baseQuery),
        scopes: inferExplicitScopesFromQuery(baseQuery),
        category: inferCategoryFromQuery(baseQuery),
      }
    : {};

  const semanticIntent = await compileSemanticQueryIntent({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    email: params.email,
    query: baseQuery,
  });
  const inferredLimit = params.request.limit ?? deterministic.limit ?? semanticIntent?.limit;
  const unread =
    typeof params.request.unread === "boolean"
      ? params.request.unread
      : typeof deterministic.unread === "boolean"
        ? deterministic.unread
        : typeof semanticIntent?.unread === "boolean"
        ? semanticIntent.unread
        : undefined;
  const hasAttachment =
    typeof params.request.hasAttachment === "boolean"
      ? params.request.hasAttachment
      : typeof deterministic.hasAttachment === "boolean"
        ? deterministic.hasAttachment
        : typeof semanticIntent?.hasAttachment === "boolean"
        ? semanticIntent.hasAttachment
        : undefined;
  const sort =
    params.request.sort && params.request.sort !== "relevance"
      ? params.request.sort
      : deterministic.sort && deterministic.sort !== "relevance"
        ? deterministic.sort
        : semanticIntent?.sort && semanticIntent.sort !== "relevance"
        ? semanticIntent.sort
        : undefined;

  const rewrittenQuery = normalize(semanticIntent?.rewrittenQuery) || baseQuery;
  const mailbox =
    params.request.mailbox ??
    deterministic.mailbox ??
    (semanticIntent?.mailbox && semanticIntent.mailbox !== "all"
      ? semanticIntent.mailbox
      : undefined);
  const scopes: UnifiedSearchSurface[] = (() => {
    if (params.request.scopes?.length) return params.request.scopes;
    // If the user explicitly constrained the mailbox (sent/drafts/etc), that implies email-only.
    if (params.request.mailbox && params.request.mailbox !== "all") return ["email"];
    if (deterministic.scopes?.length) return deterministic.scopes;
    // Do not narrow by semantic intent: when scopes are not explicitly provided, default to all surfaces.
    return [...DEFAULT_SURFACES];
  })();

  const category = params.request.category ?? deterministic.category ?? semanticIntent?.category;

  const hasStructuredConstraints = Boolean(
    typeof params.request.unread === "boolean" ||
      typeof params.request.hasAttachment === "boolean" ||
      params.request.from ||
      params.request.to ||
      params.request.cc ||
      params.request.attendeeEmail ||
      params.request.locationContains ||
      params.request.calendarIds?.length ||
      params.request.category ||
      params.request.attachmentMimeTypes?.length ||
      params.request.attachmentFilenameContains ||
      inferredDateRange,
  );

  const needsClarification =
    semanticIntent?.needsClarification === true ||
    (baseQuery.length === 0 &&
      !hasStructuredConstraints &&
      Boolean(params.request.mailbox || params.request.scopes));

  const terms = dedupe([
    ...tokenize(rewrittenQuery),
    ...tokenize(normalize(params.request.from)),
    ...tokenize(normalize(params.request.to)),
    ...tokenize(normalize(params.request.attendeeEmail)),
  ]);

  const aliasRows = await lookupSearchAliasExpansions({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    terms,
  });

  const aliasExpansions = dedupe(
    aliasRows.map((row) => row.canonicalValue).filter(Boolean),
  );

  const queryVariants =
    rewrittenQuery.length > 0
      ? dedupe([
          rewrittenQuery,
          aliasExpansions.join(" "),
          dedupe([...terms, ...aliasExpansions]).join(" "),
        ])
      : [];

  return {
    query: baseQuery,
    rewrittenQuery,
    queryVariants,
    scopes,
    mailbox,
    sort,
    unread,
    hasAttachment,
    category,
    dateRange: inferredDateRange,
    inferredLimit,
    needsClarification,
    clarificationPrompt:
      semanticIntent?.clarificationPrompt ??
      (needsClarification ? "What should I search for (keywords, person, or a date range)?" : undefined),
    aliasExpansions,
    terms,
  };
}
