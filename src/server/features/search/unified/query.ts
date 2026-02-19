import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel, type ModelType } from "@/server/lib/llms/model";
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
    mailboxExplicit: z.boolean().optional(),
    categoryExplicit: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    dateRange: z
      .object({
        after: z.string().max(80).optional(),
        before: z.string().max(80).optional(),
        timeZone: z.string().max(80).optional(),
      })
      .optional(),
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
  timeZone: string;
}): Promise<z.infer<typeof semanticQueryCompilerSchema> | null> {
  if (!shouldUseSemanticQueryCompiler()) return null;
  if (!params.query.trim()) return null;
  if (!params.emailAccountId || !params.email) return null;
  const emailAccountId = params.emailAccountId;
  const email = params.email;

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

  const tryCompile = async (
    modelType: ModelType,
  ): Promise<z.infer<typeof semanticQueryCompilerSchema> | null> => {
    const modelOptions = getModel(modelType);
    const generate = createGenerateObject({
      emailAccount: {
        id: emailAccountId,
        email,
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
        "Set mailboxExplicit/categoryExplicit to true only when the user explicitly asks for that mailbox/category.",
        "Extract dateRange when the user expresses temporal windows (today, yesterday, last 7 days, next week, this month, specific dates).",
        "Use the supplied user timezone for interpreting relative dates.",
        "Set rewrittenQuery to semantic content terms only. Omit operational words (e.g. unread/latest/show/list).",
        "If request is purely operational (e.g. '10 most recent unread emails'), rewrittenQuery should be empty or omitted.",
        "If intent is ambiguous or underspecified, set needsClarification=true and provide a short clarificationPrompt.",
        "Do not hallucinate people, dates, or mailbox scopes.",
      ].join("\n"),
      prompt: [
        `Current UTC date: ${new Date().toISOString().slice(0, 10)}`,
        `User timezone: ${params.timeZone}`,
        `Search query: ${params.query}`,
      ].join("\n"),
    });

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
  };

  const modelOrder: ModelType[] = ["economy", "default"];
  for (const modelType of modelOrder) {
    const compiled = await tryCompile(modelType);
    if (compiled) return compiled;
  }
  return null;
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
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

export interface PlannedUnifiedSearchQuery {
  query: string;
  rewrittenQuery: string;
  queryVariants: string[];
  scopes: UnifiedSearchSurface[];
  mailbox?: UnifiedSearchMailbox;
  mailboxExplicit?: boolean;
  sort?: UnifiedSearchSort;
  unread?: boolean;
  hasAttachment?: boolean;
  category?: UnifiedSearchEmailCategory;
  categoryExplicit?: boolean;
  dateRange?: UnifiedSearchDateRange;
  inferredLimit?: number;
  needsClarification?: boolean;
  clarificationPrompt?: string;
  aliasExpansions: string[];
  terms: string[];
}

function hasEmailSearchSignal(params: {
  request: UnifiedSearchRequest;
  semanticIntent: z.infer<typeof semanticQueryCompilerSchema> | null;
}): boolean {
  const { request, semanticIntent } = params;
  if (request.scopes?.includes("email")) return true;
  if (semanticIntent?.scopes?.includes("email")) return true;
  if (request.mailbox || semanticIntent?.mailbox) return true;
  if (request.category || semanticIntent?.category) return true;
  if (request.from || request.to || request.cc) return true;
  if (request.fromEmails?.length || request.fromDomains?.length) return true;
  if (request.toEmails?.length || request.toDomains?.length) return true;
  if (request.ccEmails?.length || request.ccDomains?.length) return true;
  if (typeof request.unread === "boolean") return true;
  if (typeof request.hasAttachment === "boolean") return true;
  if (request.attachmentMimeTypes?.length || request.attachmentFilenameContains) return true;
  return false;
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

  const semanticIntent = await compileSemanticQueryIntent({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    email: params.email,
    query: baseQuery,
    timeZone: resolvedTimeZone,
  });
  const inferredLimit = params.request.limit ?? semanticIntent?.limit;
  const unread =
    typeof params.request.unread === "boolean"
      ? params.request.unread
      : typeof semanticIntent?.unread === "boolean"
      ? semanticIntent.unread
      : undefined;
  const hasAttachment =
    typeof params.request.hasAttachment === "boolean"
      ? params.request.hasAttachment
      : typeof semanticIntent?.hasAttachment === "boolean"
      ? semanticIntent.hasAttachment
      : undefined;
  const sort =
    params.request.sort && params.request.sort !== "relevance"
      ? params.request.sort
      : semanticIntent?.sort && semanticIntent.sort !== "relevance"
      ? semanticIntent.sort
      : undefined;
  const inferredDateRange =
    params.request.dateRange ??
    (semanticIntent?.dateRange &&
    (semanticIntent.dateRange.after ||
      semanticIntent.dateRange.before ||
      semanticIntent.dateRange.timeZone)
      ? {
          after: semanticIntent.dateRange.after,
          before: semanticIntent.dateRange.before,
          timeZone: semanticIntent.dateRange.timeZone,
        }
      : undefined);

  const rewrittenQuery = normalize(semanticIntent?.rewrittenQuery) || baseQuery;
  const requestedMailbox = params.request.mailbox;
  const semanticMailbox = semanticIntent?.mailbox;
  const mailboxExplicit =
    Boolean(requestedMailbox ?? semanticMailbox) &&
    (Boolean(requestedMailbox) || semanticIntent?.mailboxExplicit === true);
  const emailSearchSignal = hasEmailSearchSignal({
    request: params.request,
    semanticIntent,
  });
  const mailbox =
    requestedMailbox ??
    semanticMailbox ??
    (emailSearchSignal && !mailboxExplicit ? "inbox" : undefined);
  const scopes: UnifiedSearchSurface[] = (() => {
    if (params.request.scopes?.length) return params.request.scopes;
    // If the user explicitly constrained the mailbox (sent/drafts/etc), that implies email-only.
    if (params.request.mailbox && params.request.mailbox !== "all") return ["email"];
    if (semanticIntent?.scopes?.length) return semanticIntent.scopes;
    if (emailSearchSignal) return ["email"];
    // When nothing indicates a specific surface, search across all supported surfaces.
    return [...DEFAULT_SURFACES];
  })();

  const requestedCategory = params.request.category;
  const semanticCategory = semanticIntent?.category;
  const categoryExplicit =
    Boolean(requestedCategory ?? semanticCategory) &&
    (Boolean(requestedCategory) || semanticIntent?.categoryExplicit === true);
  const category =
    requestedCategory ??
    semanticCategory ??
    (mailbox === "inbox" && emailSearchSignal && !categoryExplicit
      ? "primary"
      : undefined);

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

  const aliasExpansions: string[] = [];

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
    mailboxExplicit,
    sort,
    unread,
    hasAttachment,
    category,
    categoryExplicit,
    dateRange: inferredDateRange,
    inferredLimit,
    needsClarification,
    clarificationPrompt:
      semanticIntent?.clarificationPrompt ??
      (needsClarification ? "search_target_unclear" : undefined),
    aliasExpansions,
    terms,
  };
}
