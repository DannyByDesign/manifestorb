import { lookupSearchAliasExpansions } from "@/server/features/search/index/repository";
import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type {
  UnifiedSearchMailbox,
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
  sort?: UnifiedSearchSort;
  unread?: boolean;
  hasAttachment?: boolean;
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
  const semanticIntent = await compileSemanticQueryIntent({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    email: params.email,
    query: baseQuery,
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

  const rewrittenQuery = normalize(semanticIntent?.rewrittenQuery) || baseQuery;
  const mailbox =
    params.request.mailbox ??
    (semanticIntent?.mailbox && semanticIntent.mailbox !== "all"
      ? semanticIntent.mailbox
      : undefined);
  const scopes = params.request.scopes ?? semanticIntent?.scopes ?? [...DEFAULT_SURFACES];

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
    inferredLimit,
    needsClarification: semanticIntent?.needsClarification === true,
    clarificationPrompt: semanticIntent?.clarificationPrompt,
    aliasExpansions,
    terms,
  };
}
