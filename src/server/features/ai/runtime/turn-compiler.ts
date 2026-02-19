import { z } from "zod";
import { toZonedTime } from "date-fns-tz";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
import type { Logger } from "@/server/lib/logger";
import type { ContextPack } from "@/server/features/memory/context-manager";
import { renderCompilerContextSlice } from "@/server/features/ai/runtime/compiler-context";

export type RuntimeTurnRouteHint = "conversation_only" | "single_tool" | "planner";
export type RuntimeToolChoice = "none" | "auto";
export type RuntimeKnowledgeSource = "internal" | "web" | "either";
export type RuntimeFreshness = "low" | "high";

export interface RuntimeSingleToolCall {
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
  onFailureText?: string;
}

export interface RuntimeTaskClause {
  domain: "general" | "inbox" | "calendar" | "policy" | "cross_surface";
  action: "read" | "mutate" | "mixed" | "meta";
  confidence: number;
}

export interface RuntimeCompiledTurn {
  routeHint: RuntimeTurnRouteHint;
  toolChoice: RuntimeToolChoice;
  knowledgeSource: RuntimeKnowledgeSource;
  freshness: RuntimeFreshness;
  conversationClauses: string[];
  taskClauses: RuntimeTaskClause[];
  metaConstraints: string[];
  needsClarification: boolean;
  singleToolCall?: RuntimeSingleToolCall;
  confidence: number;
  source: "compiler_model" | "compiler_fallback";
}

const GREETING_RE =
  /^(hi|hello|hey|yo|sup|good morning|good afternoon|good evening|howdy)[\s!.?]*$/u;
const CAPABILITIES_RE =
  /\b(what can you do|capabilit(?:y|ies)|how can you help|what do you do|help me understand)\b/u;
const CONVERSATION_ONLY_SIGNAL_RE =
  /\b(thought partner|brainstorm|challenge my assumptions|help me think|just thinking out loud|talk through|reflect)\b/u;
const ATTACHMENT_RE = /\battach(?:ment|ments|ed)?\b|\battatch(?:ment|ments|ed)?\b/u;

const WEB_DIRECT_SIGNAL_RE =
  /\b(search\s+(?:the\s+)?(?:web|internet)|search\s+online|google|look\s+up\s+(?:online|on\s+(?:the\s+)?(?:web|internet))|browse\s+the\s+web)\b/u;
const INTERNAL_SURFACE_SIGNAL_RE =
  /\b(inbox|email|emails|calendar|meeting|meetings|event|events|schedule|draft|reply|label|archive|trash|unsubscribe|block|rule|policy|memory|remember|recall)\b/u;

const META_CONSTRAINT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:fresh|new)\s+search\b/u, label: "fresh_search" },
  { pattern: /\bnot\s+from\s+(?:our\s+)?conversation\s+memory\b/u, label: "not_from_conversation_memory" },
  { pattern: /\bnot\s+from\s+memory\b/u, label: "not_from_memory" },
  { pattern: /\bnot\s+from\s+chat\s+history\b/u, label: "not_from_chat_history" },
  { pattern: /\bfrom\s+scratch\b/u, label: "from_scratch" },
];

const SUSPICIOUS_SLOT_RE =
  /\b(conversation|chat\s+history|memory|our\s+conversation|previous\s+messages|this\s+chat)\b/iu;

const ATTACHMENT_TERM_CAPTURE_RE =
  /\b(?:containing|with|including|include|contains)\s+["'“”]?([^"'“”,.!?]{2,80}?)?["'“”]?\s+att(?:ach|atch)\w*\b/iu;

const compilerSchema = z
  .object({
    toolChoice: z.enum(["none", "auto"]).default("auto"),
    knowledgeSource: z.enum(["internal", "web", "either"]).default("either"),
    freshness: z.enum(["low", "high"]).default("low"),
    routeHint: z.enum(["conversation_only", "single_tool", "planner"]),
    conversationClauses: z.array(z.string().min(1)).max(8).default([]),
    taskClauses: z
      .array(
        z.object({
          domain: z.enum(["general", "inbox", "calendar", "policy", "cross_surface"]),
          action: z.enum(["read", "mutate", "mixed", "meta"]),
          confidence: z.number().min(0).max(1),
        }),
      )
      .max(6)
      .default([]),
    metaConstraints: z.array(z.string().min(1)).max(8).default([]),
    needsClarification: z.boolean().default(false),
    confidence: z.number().min(0).max(1).default(0.5),
    singleToolCandidate: z
      .object({
        toolName: z.enum([
          "email.getUnreadCount",
          "email.searchInbox",
          "email.searchSent",
          "calendar.listEvents",
          "web.search",
        ]),
        reason: z.string().min(1).max(120),
        confidence: z.number().min(0).max(1),
        args: z
          .object({
            scope: z.enum(["inbox", "sent"]).optional(),
            query: z.string().min(1).max(500).optional(),
            text: z.string().min(1).max(500).optional(),
            from: z.string().min(1).max(320).optional(),
            to: z.string().min(1).max(320).optional(),
            cc: z.string().min(1).max(320).optional(),
            fromConcept: z.string().min(1).max(120).optional(),
            toConcept: z.string().min(1).max(120).optional(),
            ccConcept: z.string().min(1).max(120).optional(),
            hasAttachment: z.boolean().optional(),
            unread: z.boolean().optional(),
            sort: z.enum(["relevance", "newest", "oldest"]).optional(),
            purpose: z.enum(["lookup", "list", "count"]).optional(),
            limit: z.number().min(1).max(5000).optional(),
            fetchAll: z.boolean().optional(),
            sentByMe: z.boolean().optional(),
            receivedByMe: z.boolean().optional(),
            attachmentIntentTerm: z.string().min(1).max(120).optional(),
            count: z.number().int().min(1).max(10).optional(),
            country: z.string().min(1).max(12).optional(),
            search_lang: z.string().min(1).max(12).optional(),
            ui_lang: z.string().min(1).max(12).optional(),
            freshness: z.string().min(1).max(64).optional(),
            dateRange: z
              .object({
                after: z.string().min(4).max(40),
                before: z.string().min(4).max(40),
              })
              .optional(),
          })
          .strict()
          .default({}),
        onFailureText: z.string().min(1).max(300).optional(),
      })
      .optional(),
  })
  .strict();

export const runtimeTurnCompilerModelSchema = compilerSchema;

type CompilerModelResult = z.infer<typeof compilerSchema>;

type SupportedSingleTool = NonNullable<CompilerModelResult["singleToolCandidate"]>["toolName"];

function shouldUseModelCompiler(): boolean {
  if (process.env.RUNTIME_TURN_COMPILER_FORCE_MODEL === "true") return true;
  if (process.env.RUNTIME_TURN_COMPILER_USE_MODEL === "false") return false;
  return process.env.VITEST !== "true" && process.env.NODE_ENV !== "test";
}

function normalizeScopeValue(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value || value.length < 2) return undefined;
  return value;
}

function normalizeAttachmentIntentTerm(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/\b(?:any|all|my|your|the|an?|emails?|messages?|inbox|sent|mail|from|for)\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length < 2) return undefined;
  return normalized;
}

function inferAttachmentIntentTerm(message: string, textScope: string | undefined): string | undefined {
  if (!ATTACHMENT_RE.test(message)) return undefined;
  const explicit = message.match(ATTACHMENT_TERM_CAPTURE_RE)?.[1];
  const normalized = normalizeAttachmentIntentTerm(normalizeScopeValue(explicit));
  if (normalized) return normalized;
  return normalizeAttachmentIntentTerm(textScope);
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

function inferDateRangeFromMessage(message: string, timeZone: string): { after: string; before: string } | null {
  const normalized = message.toLowerCase();
  const nowLocal = toZonedTime(new Date(), timeZone);
  const today = startOfLocalDay(nowLocal);

  if (/\bthis month\b/u.test(normalized)) {
    const { start, end } = monthBounds(today);
    return { after: formatLocalYmd(start), before: formatLocalYmd(end) };
  }

  if (/\blast month\b/u.test(normalized)) {
    const { start, end } = lastMonthBounds(today);
    return { after: formatLocalYmd(start), before: formatLocalYmd(end) };
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

  return null;
}

function stripTrailingTemporalPhrase(value: string): string {
  return value
    .replace(
      /\s+(?:in\s+)?(?:the\s+)?(?:last|past)\s+\d{1,3}\s+(?:day|days|week|weeks|month|months|year|years)\b.*$/iu,
      "",
    )
    .replace(
      /\s+(?:today|tonight|tomorrow|yesterday|this\s+week|next\s+week|this\s+month|last\s+month)\b.*$/iu,
      "",
    )
    .trim();
}

function sanitizeSenderValue(raw: unknown): string | undefined {
  const normalized = normalizeScopeValue(raw);
  if (!normalized) return undefined;
  const stripped = stripTrailingTemporalPhrase(normalized);
  if (!stripped || stripped.length < 2) return undefined;
  if (SUSPICIOUS_SLOT_RE.test(stripped)) return undefined;
  return stripped;
}

function sanitizeDateRange(value: unknown): { after: string; before: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const after = normalizeScopeValue(raw.after);
  const before = normalizeScopeValue(raw.before);
  if (!after || !before) return undefined;
  return { after, before };
}

function sanitizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function sanitizePurpose(value: unknown): "lookup" | "list" | "count" | undefined {
  return value === "lookup" || value === "list" || value === "count" ? value : undefined;
}

function sanitizeSort(
  value: unknown,
): "relevance" | "newest" | "oldest" | undefined {
  return value === "relevance" || value === "newest" || value === "oldest"
    ? value
    : undefined;
}

function sanitizeLimit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(5000, Math.trunc(value)));
}

function sanitizeWebCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(10, Math.trunc(value)));
}

function defaultSingleToolReason(toolName: SupportedSingleTool): string {
  switch (toolName) {
    case "email.getUnreadCount":
      return "email_unread_count";
    case "email.searchSent":
      return "email_sent_list";
    case "calendar.listEvents":
      return "calendar_read_window";
    case "web.search":
      return "web_search";
    case "email.searchInbox":
    default:
      return "email_inbox_list";
  }
}

function defaultSingleToolFailureText(toolName: SupportedSingleTool): string {
  switch (toolName) {
    case "email.getUnreadCount":
      return "I couldn't load your unread email count right now.";
    case "email.searchSent":
    case "email.searchInbox":
      return "I couldn't load those emails right now.";
    case "calendar.listEvents":
      return "I couldn't read your calendar right now.";
    case "web.search":
      return "I couldn't search the web right now.";
    default:
      return "I hit a temporary issue while handling that.";
  }
}

function stripLeadingWebSearchPreamble(message: string): string {
  return message
    .trim()
    .replace(/^(?:can you|could you|please|pls)\s+/iu, "")
    .replace(
      /^(?:search\s+(?:the\s+)?(?:web|internet)|search\s+online|browse\s+the\s+web)\s+(?:for\s+)?/iu,
      "",
    )
    .replace(/^(?:google|look\s+up)\s+/iu, "")
    .trim();
}

function shouldSingleToolWebSearch(message: string): boolean {
  const normalized = message.toLowerCase();
  if (CONVERSATION_ONLY_SIGNAL_RE.test(normalized)) return false;
  if (INTERNAL_SURFACE_SIGNAL_RE.test(normalized)) return false;
  if (WEB_DIRECT_SIGNAL_RE.test(normalized)) return true;
  return false;
}

async function resolveTimeZone(params: {
  userId: string;
  emailAccountId: string;
  logger: Logger;
}): Promise<string> {
  try {
    const tz = await resolveDefaultCalendarTimeZone({
      userId: params.userId,
      emailAccountId: params.emailAccountId,
    });
    if ("error" in tz) return "UTC";
    return tz.timeZone;
  } catch (error) {
    params.logger.warn("Turn compiler timezone resolution failed", { error });
    return "UTC";
  }
}

async function buildSingleToolCallFromCandidate(params: {
  candidate: NonNullable<CompilerModelResult["singleToolCandidate"]>;
  message: string;
  userId: string;
  emailAccountId: string;
  logger: Logger;
}): Promise<RuntimeSingleToolCall | undefined> {
  const { candidate } = params;
  if (candidate.confidence < 0.78) return undefined;

  if (candidate.toolName === "web.search") {
    const query =
      normalizeScopeValue(candidate.args.query) ??
      normalizeScopeValue(stripLeadingWebSearchPreamble(params.message)) ??
      "";
    if (!query) return undefined;

    const count = sanitizeWebCount(candidate.args.count);
    const country = normalizeScopeValue(candidate.args.country);
    const search_lang = normalizeScopeValue(candidate.args.search_lang);
    const ui_lang = normalizeScopeValue(candidate.args.ui_lang);
    const freshness = normalizeScopeValue(candidate.args.freshness);

    return {
      toolName: "web.search",
      args: {
        query,
        ...(typeof count === "number" ? { count } : {}),
        ...(country ? { country } : {}),
        ...(search_lang ? { search_lang } : {}),
        ...(ui_lang ? { ui_lang } : {}),
        ...(freshness ? { freshness } : {}),
      },
      reason: candidate.reason || defaultSingleToolReason(candidate.toolName),
      onFailureText: candidate.onFailureText ?? defaultSingleToolFailureText(candidate.toolName),
    };
  }

  if (candidate.toolName === "email.getUnreadCount") {
    return {
      toolName: "email.getUnreadCount",
      args: { scope: "inbox" },
      reason: candidate.reason || defaultSingleToolReason(candidate.toolName),
      onFailureText: candidate.onFailureText ?? defaultSingleToolFailureText(candidate.toolName),
    };
  }

  if (candidate.toolName === "calendar.listEvents") {
    const timeZone = await resolveTimeZone(params);
    const explicitDateRange = sanitizeDateRange(candidate.args.dateRange);
    const inferredDateRange = explicitDateRange ?? inferDateRangeFromMessage(params.message, timeZone);
    if (!inferredDateRange) return undefined;
    return {
      toolName: "calendar.listEvents",
      args: {
        dateRange: inferredDateRange,
        limit: sanitizeLimit(candidate.args.limit) ?? 20,
      },
      reason: candidate.reason || defaultSingleToolReason(candidate.toolName),
      onFailureText: candidate.onFailureText ?? defaultSingleToolFailureText(candidate.toolName),
    };
  }

  const timeZone = await resolveTimeZone(params);
  const query = normalizeScopeValue(candidate.args.query);
  const text = normalizeScopeValue(candidate.args.text);
  const fromConcept = normalizeScopeValue(candidate.args.fromConcept);
  const toConcept = normalizeScopeValue(candidate.args.toConcept);
  const ccConcept = normalizeScopeValue(candidate.args.ccConcept);
  const from = fromConcept ? undefined : sanitizeSenderValue(candidate.args.from);
  const to = toConcept ? undefined : normalizeScopeValue(candidate.args.to);
  const cc = ccConcept ? undefined : normalizeScopeValue(candidate.args.cc);
  const hasAttachment = sanitizeBoolean(candidate.args.hasAttachment);
  const unread = sanitizeBoolean(candidate.args.unread);
  const sort = sanitizeSort(candidate.args.sort);
  const purpose = sanitizePurpose(candidate.args.purpose) ?? "list";
  const explicitDateRange = sanitizeDateRange(candidate.args.dateRange);
  const dateRange = explicitDateRange ?? inferDateRangeFromMessage(params.message, timeZone);
  const attachmentIntentTerm =
    normalizeAttachmentIntentTerm(normalizeScopeValue(candidate.args.attachmentIntentTerm)) ??
    inferAttachmentIntentTerm(params.message, text ?? query);

  const semanticQuery = query ?? normalizeScopeValue(params.message) ?? "";

  const args: Record<string, unknown> = {
    query: semanticQuery,
    purpose,
    limit: sanitizeLimit(candidate.args.limit) ?? (purpose === "count" ? 100 : dateRange ? 100 : 25),
    fetchAll: sanitizeBoolean(candidate.args.fetchAll) ?? false,
  };

  if (dateRange) args.dateRange = dateRange;
  if (from) args.from = from;
  if (fromConcept) args.fromConcept = fromConcept;
  if (to) args.to = to;
  if (toConcept) args.toConcept = toConcept;
  if (cc) args.cc = cc;
  if (ccConcept) args.ccConcept = ccConcept;
  if (typeof hasAttachment === "boolean") args.hasAttachment = hasAttachment;
  if (typeof unread === "boolean") args.unread = unread;
  if (sort) args.sort = sort;
  if (attachmentIntentTerm) args.text = attachmentIntentTerm;

  if (candidate.toolName === "email.searchSent") {
    args.sentByMe = true;
  } else {
    const sentByMe = sanitizeBoolean(candidate.args.sentByMe);
    if (typeof sentByMe === "boolean") args.sentByMe = sentByMe;
  }

  const receivedByMe = sanitizeBoolean(candidate.args.receivedByMe);
  if (typeof receivedByMe === "boolean") args.receivedByMe = receivedByMe;

  return {
    toolName: candidate.toolName,
    args,
    reason: candidate.reason || defaultSingleToolReason(candidate.toolName),
    onFailureText: candidate.onFailureText ?? defaultSingleToolFailureText(candidate.toolName),
  };
}

function extractMetaConstraints(message: string): string[] {
  const constraints: string[] = [];
  for (const entry of META_CONSTRAINT_PATTERNS) {
    if (entry.pattern.test(message)) constraints.push(entry.label);
  }
  return constraints;
}

async function compileWithModel(params: {
  message: string;
  userId: string;
  email: string;
  emailAccountId: string;
  logger: Logger;
  contextPack?: ContextPack;
}): Promise<CompilerModelResult | null> {
  if (!shouldUseModelCompiler()) return null;

  const modelOptions = getModel("economy");
  const generate = createGenerateObject({
    emailAccount: {
      id: params.emailAccountId,
      email: params.email,
      userId: params.userId,
    },
    label: "openworld-turn-compiler",
    modelOptions,
    maxLLMRetries: 0,
  });

  const run = generate({
    model: modelOptions.model,
    schema: compilerSchema,
    system: [
      "You compile a user turn into structured intent for a conversational AI runtime.",
      "Return JSON only.",
      "Primary goal: preserve conversational nuance. Do not force tool execution when intent is ambiguous.",
      "Decide toolChoice: use `none` for purely conversational/reflection/brainstorming turns; use `auto` when the user is asking for an action or factual lookup that benefits from tools.",
      "Decide knowledgeSource: `internal` for inbox/calendar/policy/memory operations; `web` for public internet research; `either` if both could help.",
      "Decide freshness: `high` only when the user explicitly requests a fresh web lookup or current public facts; otherwise `low`.",
      "`singleToolCandidate` is optional and only for high-confidence one-tool requests.",
      "If uncertain, set routeHint=planner and needsClarification=true.",
      "Meta constraints like 'not from conversation memory' are metaConstraints, not sender filters.",
      "For 'from <person> in the last N days', set args.from to the person only and put timeframe in dateRange.",
      "Preserve ordering intent explicitly in tool args: use sort=newest for latest/most-recent/newest phrasing and sort=oldest for oldest/earliest phrasing.",
      "Preserve read-state intent explicitly in tool args: use unread=true for unread-only and unread=false for read-only phrasing.",
      "If the user uses role/group language for sender/recipient (e.g. 'recruiters', 'founders', 'investors', 'customers', 'press'), do not guess who that means.",
      "Instead, set args.fromConcept/args.toConcept/args.ccConcept to the exact phrase and leave args.from/args.to/args.cc empty.",
      "When using fromConcept/toConcept/ccConcept in a single-tool email search, keep needsClarification=false so the tool can return structured clarification evidence.",
      "Allowed single tools: email.getUnreadCount, email.searchInbox, email.searchSent, calendar.listEvents, web.search.",
      "Do not invent tools or unsupported args.",
    ].join("\n"),
    prompt: [
      `Current UTC date: ${new Date().toISOString().slice(0, 10)}`,
      (() => {
        const slice = renderCompilerContextSlice(params.contextPack);
        return slice ? `Context for follow-ups (recent history + pending state):\n${slice}` : "";
      })(),
      `User turn: ${params.message}`,
    ].join("\n"),
  });

  const timeoutMs = Math.min(
    Math.max(Number.parseInt(process.env.RUNTIME_TURN_COMPILER_TIMEOUT_MS ?? "1400", 10) || 1400, 500),
    4_000,
  );

  try {
    const result = await Promise.race([
      run,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!result) return null;
    return compilerSchema.parse(result.object);
  } catch (error) {
    params.logger.warn("Turn compiler model path failed; using fallback", { error });
    return null;
  }
}

export async function compileRuntimeTurn(params: {
  message: string;
  userId: string;
  email: string;
  emailAccountId: string;
  logger: Logger;
  contextPack?: ContextPack;
}): Promise<RuntimeCompiledTurn> {
  const message = params.message.trim();
  const normalized = message.toLowerCase();
  const metaConstraints = extractMetaConstraints(normalized);

  if (GREETING_RE.test(normalized)) {
    return {
      toolChoice: "none",
      knowledgeSource: "either",
      freshness: "low",
      routeHint: "conversation_only",
      conversationClauses: [message],
      taskClauses: [],
      metaConstraints,
      needsClarification: false,
      confidence: 0.98,
      source: "compiler_fallback",
    };
  }

  if (CAPABILITIES_RE.test(normalized)) {
    return {
      toolChoice: "none",
      knowledgeSource: "either",
      freshness: "low",
      routeHint: "conversation_only",
      conversationClauses: [message],
      taskClauses: [],
      metaConstraints,
      needsClarification: false,
      confidence: 0.95,
      source: "compiler_fallback",
    };
  }

  if (shouldSingleToolWebSearch(message)) {
    const query = normalizeScopeValue(stripLeadingWebSearchPreamble(message)) ?? message;
    return {
      toolChoice: "auto",
      knowledgeSource: "web",
      freshness: metaConstraints.includes("fresh_search") ? "high" : "low",
      routeHint: "single_tool",
      conversationClauses: [],
      taskClauses: [{ domain: "general", action: "read", confidence: 0.7 }],
      metaConstraints,
      needsClarification: false,
      singleToolCall: {
        toolName: "web.search",
        args: { query },
        reason: "web_search",
        onFailureText: "I couldn't search the web right now.",
      },
      confidence: 0.72,
      source: "compiler_fallback",
    };
  }

  const modelResult = await compileWithModel(params);

  if (modelResult) {
    const mergedMeta = [...new Set([...(modelResult.metaConstraints ?? []), ...metaConstraints])];
    const singleToolCall = modelResult.singleToolCandidate
      ? await buildSingleToolCallFromCandidate({
          candidate: modelResult.singleToolCandidate,
          message,
          userId: params.userId,
          emailAccountId: params.emailAccountId,
          logger: params.logger,
        })
      : undefined;

    if (singleToolCall && !modelResult.needsClarification) {
      const inferredTaskClause: RuntimeTaskClause =
        singleToolCall.toolName.startsWith("email.")
          ? { domain: "inbox", action: "read", confidence: 0.8 }
          : singleToolCall.toolName.startsWith("web.")
            ? { domain: "general", action: "read", confidence: 0.8 }
          : { domain: "calendar", action: "read", confidence: 0.8 };
      return {
        toolChoice: modelResult.toolChoice,
        knowledgeSource: modelResult.knowledgeSource,
        freshness: modelResult.freshness,
        routeHint: "single_tool",
        conversationClauses: modelResult.conversationClauses,
        taskClauses:
          modelResult.taskClauses.length > 0
            ? modelResult.taskClauses
            : [inferredTaskClause],
        metaConstraints: mergedMeta,
        needsClarification: false,
        singleToolCall,
        confidence: Number(Math.max(modelResult.confidence, modelResult.singleToolCandidate?.confidence ?? 0).toFixed(4)),
        source: "compiler_model",
      };
    }

    const modelConversationOnly =
      modelResult.routeHint === "conversation_only" &&
      modelResult.taskClauses.length === 0 &&
      !modelResult.needsClarification;

    if (modelConversationOnly) {
      return {
        toolChoice: "none",
        knowledgeSource: modelResult.knowledgeSource,
        freshness: modelResult.freshness,
        routeHint: "conversation_only",
        conversationClauses:
          modelResult.conversationClauses.length > 0
            ? modelResult.conversationClauses
            : [message],
        taskClauses: [],
        metaConstraints: mergedMeta,
        needsClarification: false,
        confidence: Number(modelResult.confidence.toFixed(4)),
        source: "compiler_model",
      };
    }

    return {
      toolChoice: modelResult.toolChoice,
      knowledgeSource: modelResult.knowledgeSource,
      freshness: modelResult.freshness,
      routeHint: "planner",
      conversationClauses: modelResult.conversationClauses,
      taskClauses:
        modelResult.taskClauses.length > 0
          ? modelResult.taskClauses
          : [{ domain: "general", action: "meta", confidence: 0.55 }],
      metaConstraints: mergedMeta,
      needsClarification: modelResult.needsClarification,
      confidence: Number(modelResult.confidence.toFixed(4)),
      source: "compiler_model",
    };
  }

  return {
    toolChoice: "auto",
    knowledgeSource: INTERNAL_SURFACE_SIGNAL_RE.test(normalized) ? "internal" : "either",
    freshness: metaConstraints.includes("fresh_search") ? "high" : "low",
    routeHint: "planner",
    conversationClauses: [],
    taskClauses: [{ domain: "general", action: "meta", confidence: 0.45 }],
    metaConstraints,
    needsClarification: false,
    confidence: 0.45,
    source: "compiler_fallback",
  };
}

export function hasRecallSignals(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\b(remember|recall|what did we|from last time|previously|earlier you said|history)\b/u.test(normalized);
}

export function inferRouteProfileFromComplexity(complexity: "simple" | "moderate" | "complex"): "fast" | "standard" | "deep" {
  if (complexity === "complex") return "deep";
  if (complexity === "moderate") return "standard";
  return "fast";
}

export function inferDomainFromTaskClauses(taskClauses: RuntimeTaskClause[]):
  | "general"
  | "inbox"
  | "calendar"
  | "policy"
  | "cross_surface" {
  if (taskClauses.length === 0) return "general";
  const domains = new Set(taskClauses.map((clause) => clause.domain));
  if (domains.has("cross_surface")) return "cross_surface";
  if (domains.size > 1) return "cross_surface";
  return taskClauses[0]?.domain ?? "general";
}

export function inferOperationFromTaskClauses(taskClauses: RuntimeTaskClause[]): "meta" | "read" | "mutate" | "mixed" {
  if (taskClauses.length === 0) return "meta";
  const actions = new Set(taskClauses.map((clause) => clause.action));
  if (actions.has("mixed")) return "mixed";
  if (actions.has("mutate") && actions.has("read")) return "mixed";
  if (actions.has("mutate")) return "mutate";
  if (actions.has("read")) return "read";
  return "meta";
}

export function inferToolHints(params: {
  domain: "general" | "inbox" | "calendar" | "policy" | "cross_surface";
  requestedOperation: "meta" | "read" | "mutate" | "mixed";
}): string[] {
  const hints = new Set<string>();
  const { domain, requestedOperation } = params;

  if (domain === "inbox" || domain === "cross_surface") {
    hints.add("group:inbox_read");
    if (requestedOperation !== "read") hints.add("group:inbox_mutate");
  }
  if (domain === "calendar" || domain === "cross_surface") {
    hints.add("group:calendar_read");
    if (requestedOperation !== "read") hints.add("group:calendar_mutate");
  }
  if (domain === "policy" || domain === "cross_surface") {
    hints.add("group:calendar_policy");
  }
  if (domain === "cross_surface") {
    hints.add("group:cross_surface_planning");
  }

  return [...hints];
}
