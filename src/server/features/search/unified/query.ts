import { lookupSearchAliasExpansions } from "@/server/features/search/index/repository";
import type {
  UnifiedSearchMailbox,
  UnifiedSearchRequest,
  UnifiedSearchSurface,
} from "@/server/features/search/unified/types";

const DEFAULT_SURFACES: UnifiedSearchSurface[] = ["email", "calendar", "rule", "memory"];

const SEARCH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "could",
  "do",
  "email",
  "emails",
  "find",
  "for",
  "from",
  "folder",
  "i",
  "in",
  "is",
  "look",
  "me",
  "message",
  "messages",
  "my",
  "please",
  "search",
  "sent",
  "show",
  "mailbox",
  "that",
  "the",
  "to",
  "up",
  "with",
  "you",
]);

const NICKNAME_EQUIVALENTS: Record<string, string[]> = {
  alex: ["alexander", "alexandra"],
  andy: ["andrew"],
  ben: ["benjamin"],
  danny: ["daniel"],
  dave: ["david"],
  jenny: ["jennifer"],
  jon: ["john", "jonathan"],
  kate: ["katherine", "kathryn"],
  liz: ["elizabeth"],
  matt: ["matthew"],
  mike: ["michael"],
  nick: ["nicholas"],
  rob: ["robert"],
  sam: ["samuel", "samantha"],
  steve: ["steven", "stephen"],
  tom: ["thomas"],
  will: ["william"],
};

const SURFACE_HINTS: Record<UnifiedSearchSurface, RegExp[]> = {
  email: [/\b(email|emails|inbox|sent|draft|message|messages|mail)\b/iu],
  calendar: [/\b(calendar|event|events|meeting|meetings|schedule|availability|slot|timeslot)\b/iu],
  rule: [/\b(rule|rules|automation|automations|policy|policies|filter|filters)\b/iu],
  memory: [/\b(memory|remember|recall|knowledge|history)\b/iu],
};

function normalize(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9@._-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function singularize(token: string): string {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith(`"`) && trimmed.endsWith(`"`)) || (trimmed.startsWith(`'`) && trimmed.endsWith(`'`))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function inferMailbox(query: string, explicit: UnifiedSearchMailbox | undefined): UnifiedSearchMailbox | undefined {
  if (explicit && explicit !== "all") return explicit;
  const normalized = query.toLowerCase();
  if (/\b(sent|outbox|i sent|sent folder)\b/u.test(normalized)) return "sent";
  if (/\b(inbox|received)\b/u.test(normalized)) return "inbox";
  if (/\b(draft|drafts)\b/u.test(normalized)) return "draft";
  if (/\b(trash|bin|deleted)\b/u.test(normalized)) return "trash";
  if (/\b(spam|junk)\b/u.test(normalized)) return "spam";
  if (/\b(archive|archived)\b/u.test(normalized)) return "archive";
  return undefined;
}

function inferScopes(query: string, explicit: UnifiedSearchSurface[] | undefined): UnifiedSearchSurface[] {
  if (explicit && explicit.length > 0) return explicit;

  const inferred = new Set<UnifiedSearchSurface>();
  for (const surface of DEFAULT_SURFACES) {
    if (SURFACE_HINTS[surface].some((pattern) => pattern.test(query))) {
      inferred.add(surface);
    }
  }

  if (inferred.size === 0) return [...DEFAULT_SURFACES];
  return [...inferred];
}

function extractQuotedPhrase(query: string): string | undefined {
  const match = query.match(/["“”']([^"“”']{2,200})["“”']/u);
  return match?.[1]?.trim();
}

function extractInstructionObject(query: string): string {
  const normalized = query.trim();
  if (!normalized) return normalized;

  const pattern =
    /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:search|find|look(?:\s+for|\s+up)?|show|check|list)\s+(?:my\s+)?(?:(?:sent|inbox|draft|trash|spam|archive)\s+)?(?:emails?|messages?|mail|calendar|events?|rules?)?\s*(?:for|about|with|containing)?\s*(.+)$/iu;
  const match = normalized.match(pattern);
  if (match?.[1]) return stripQuotes(match[1]);

  return stripQuotes(normalized);
}

function compactSearchTerms(query: string): string {
  const terms = tokenize(query).filter((token) => !SEARCH_STOPWORDS.has(token));
  return terms.join(" ").trim();
}

function expandTermVariants(terms: string[]): string[] {
  const expanded = new Set<string>();
  for (const term of terms) {
    if (!term || term.length <= 1) continue;
    expanded.add(term);
    expanded.add(singularize(term));
    if (term in NICKNAME_EQUIVALENTS) {
      for (const value of NICKNAME_EQUIVALENTS[term] ?? []) {
        expanded.add(value);
      }
    }
  }
  return [...expanded];
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
  aliasExpansions: string[];
  terms: string[];
}

export async function planUnifiedSearchQuery(params: {
  userId: string;
  emailAccountId?: string;
  request: UnifiedSearchRequest;
}): Promise<PlannedUnifiedSearchQuery> {
  const baseQuery = normalize(params.request.query) || normalize(params.request.text);
  const quotedPhrase = extractQuotedPhrase(baseQuery);
  const instructionObject = extractInstructionObject(baseQuery);
  const compacted = compactSearchTerms(instructionObject);

  const rewrittenQuery = quotedPhrase || compacted || instructionObject || baseQuery;
  const mailbox = inferMailbox(`${baseQuery} ${params.request.mailbox ?? ""}`.trim(), params.request.mailbox);
  const scopes = inferScopes(baseQuery, params.request.scopes);

  const terms = dedupe([
    ...tokenize(rewrittenQuery),
    ...tokenize(normalize(params.request.from)),
    ...tokenize(normalize(params.request.to)),
    ...tokenize(normalize(params.request.attendeeEmail)),
  ]);
  const expandedTerms = expandTermVariants(terms);

  const aliasRows = await lookupSearchAliasExpansions({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    terms: expandedTerms,
  });

  const aliasExpansions = dedupe(aliasRows.map((row) => row.canonicalValue).filter(Boolean));

  const queryVariants = dedupe([
    rewrittenQuery,
    instructionObject,
    compacted,
    quotedPhrase ?? "",
    expandedTerms.join(" "),
    aliasExpansions.join(" "),
    dedupe([...terms, ...aliasExpansions]).join(" "),
    dedupe([...expandedTerms, ...aliasExpansions]).join(" "),
  ]);

  return {
    query: baseQuery,
    rewrittenQuery,
    queryVariants,
    scopes,
    mailbox,
    aliasExpansions,
    terms: expandedTerms,
  };
}
