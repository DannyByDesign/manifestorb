import { z } from "zod";
import { toZonedTime } from "date-fns-tz";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
import type { Logger } from "@/server/lib/logger";

export type RuntimeTurnRouteHint = "conversation_only" | "single_tool" | "planner";

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
  conversationClauses: string[];
  taskClauses: RuntimeTaskClause[];
  metaConstraints: string[];
  needsClarification: boolean;
  singleToolCall?: RuntimeSingleToolCall;
  conversationFallbackText?: string;
  confidence: number;
  source: "compiler_model" | "compiler_fallback";
}

const GREETING_RE =
  /^(hi|hello|hey|yo|sup|good morning|good afternoon|good evening|howdy)[\s!.?]*$/u;
const CAPABILITIES_RE =
  /\b(what can you do|capabilit(?:y|ies)|how can you help|what do you do|help me understand)\b/u;
const EMAIL_ENTITY_RE = /\b(email|emails|inbox|message|messages|thread|threads|mailbox|outbox)\b/u;
const CALENDAR_ENTITY_RE = /\b(calendar|meeting|meetings|event|events|schedule)\b/u;
const POLICY_ENTITY_RE = /\b(rule|rules|automation|automations|policy|policies)\b/u;
const LOOKUP_VERB_RE = /\b(show|list|find|check|lookup|search|what|which|when|where|who|scan|fetch)\b/u;
const MUTATION_VERB_RE =
  /\b(create|update|edit|change|delete|remove|archive|trash|send|reply|move|label|reschedule|book|cancel|approve|deny|unsubscribe|block)\b/u;
const CONDITIONAL_RE = /\b(if|unless|otherwise|except|only if|when)\b/u;
const CHAINING_RE = /\b(and then|then|also|plus|follow(?:ed)? by|after that|before that|next)\b/u;
const SENT_MAILBOX_RE =
  /\b(?:my\s+)?sent\s+(?:inbox|emails?|messages?|mail|threads?|folder)\b|\bsent\s+mailbox\b|\boutbox\b/u;
const COUNT_RE = /\b(how many|count|number of)\b/u;
const UNREAD_RE = /\bunread\b/u;
const ATTACHMENT_RE = /\battach(?:ment|ments|ed)?\b|\battatch(?:ment|ments|ed)?\b/u;
const META_CONSTRAINT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:fresh|new)\s+search\b/u, label: "fresh_search" },
  { pattern: /\bnot\s+from\s+(?:our\s+)?conversation\s+memory\b/u, label: "not_from_conversation_memory" },
  { pattern: /\bnot\s+from\s+memory\b/u, label: "not_from_memory" },
  { pattern: /\bnot\s+from\s+chat\s+history\b/u, label: "not_from_chat_history" },
  { pattern: /\bfrom\s+scratch\b/u, label: "from_scratch" },
];

const SUSPICIOUS_SLOT_RE =
  /\b(conversation|chat\s+history|memory|our\s+conversation|previous\s+messages|this\s+chat)\b/iu;

const SENDER_SCOPE_RE = /\b(?:from|by)\s+([^,.!?]+?)(?=\s+(?:today|tonight|tomorrow|this week|next week|this month|last month)\b|$)/iu;
const QUOTED_TEXT_RE = /(?:^|\s)["'“”]([^"'“”]{2,})["'“”](?:$|\s|[,.!?])/u;
const FOR_TEXT_RE = /\bfor\s+([^,.!?]+?)(?=\s+(?:today|tonight|tomorrow|this week|next week|this month|last month)\b|$)/iu;
const ATTACHMENT_TERM_CAPTURE_RE =
  /\b(?:containing|with|including|include|contains)\s+["'“”]?([^"'“”,.!?]{2,80}?)?["'“”]?\s+att(?:ach|atch)\w*\b/iu;

const compilerSchema = z
  .object({
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
  })
  .strict();

const ENABLE_MODEL_COMPILER =
  process.env.VITEST !== "true" && process.env.NODE_ENV !== "test";

function normalizeScopeValue(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value || value.length < 2) return undefined;
  return value;
}

function parseSenderScope(message: string): string | undefined {
  const match = message.match(SENDER_SCOPE_RE);
  const sender = normalizeScopeValue(match?.[1]);
  if (!sender) return undefined;
  if (SUSPICIOUS_SLOT_RE.test(sender)) return undefined;
  return sender;
}

function parseTextScope(message: string): string | undefined {
  const quoted = normalizeScopeValue(message.match(QUOTED_TEXT_RE)?.[1]);
  if (quoted) return quoted;
  const scoped = normalizeScopeValue(message.match(FOR_TEXT_RE)?.[1]);
  if (!scoped) return undefined;
  if (/^(?:me|myself|us|ourselves)$/iu.test(scoped)) return undefined;
  return scoped;
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
  const normalized = normalizeAttachmentIntentTerm(explicit);
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

function extractMetaConstraints(message: string): string[] {
  const constraints: string[] = [];
  for (const entry of META_CONSTRAINT_PATTERNS) {
    if (entry.pattern.test(message)) constraints.push(entry.label);
  }
  return constraints;
}

function fastCapabilitiesReply(): string {
  return [
    "I can help across inbox and calendar.",
    "I can search and summarize email, draft and send replies with approval safeguards, and manage labels and rules.",
    "I can review your schedule, find availability, create or reschedule events, and enforce your policy guardrails.",
  ].join(" ");
}

function resolveIntent(message: string): {
  intent:
    | "greeting"
    | "capabilities"
    | "inbox_read"
    | "inbox_attention"
    | "inbox_mutation"
    | "calendar_read"
    | "calendar_mutation"
    | "policy_controls"
    | "cross_surface_plan"
    | "general";
  domain: "general" | "inbox" | "calendar" | "policy" | "cross_surface";
  action: "meta" | "read" | "mutate" | "mixed";
} {
  const normalized = message.toLowerCase();
  if (GREETING_RE.test(normalized)) {
    return { intent: "greeting", domain: "general", action: "meta" };
  }
  if (CAPABILITIES_RE.test(normalized)) {
    return { intent: "capabilities", domain: "general", action: "meta" };
  }

  const hasEmail = EMAIL_ENTITY_RE.test(normalized);
  const hasCalendar = CALENDAR_ENTITY_RE.test(normalized);
  const hasPolicy = POLICY_ENTITY_RE.test(normalized);
  const mutation = MUTATION_VERB_RE.test(normalized);

  if ((hasEmail && hasCalendar) || (hasPolicy && (hasEmail || hasCalendar))) {
    return { intent: "cross_surface_plan", domain: "cross_surface", action: "mixed" };
  }
  if (hasEmail && /\bunread|attention|reply\b/u.test(normalized)) {
    return { intent: "inbox_attention", domain: "inbox", action: "read" };
  }
  if (hasEmail && mutation) return { intent: "inbox_mutation", domain: "inbox", action: "mutate" };
  if (hasCalendar && mutation) return { intent: "calendar_mutation", domain: "calendar", action: "mutate" };
  if (hasEmail) return { intent: "inbox_read", domain: "inbox", action: "read" };
  if (hasCalendar) return { intent: "calendar_read", domain: "calendar", action: "read" };
  if (hasPolicy) return { intent: "policy_controls", domain: "policy", action: mutation ? "mixed" : "read" };
  return { intent: "general", domain: "general", action: mutation ? "mutate" : "read" };
}

function inferComplexity(message: string, action: "meta" | "read" | "mutate" | "mixed"): "simple" | "moderate" | "complex" {
  const normalized = message.toLowerCase();
  const tokens = normalized.split(/\s+/u).filter(Boolean).length;
  const hasConditional = CONDITIONAL_RE.test(normalized);
  const chainCount = [...normalized.matchAll(new RegExp(CHAINING_RE.source, "gu"))].length;

  if (tokens > 45 || hasConditional || chainCount >= 2) return "complex";
  if (tokens > 20 || action === "mutate" || chainCount === 1) return "moderate";
  return "simple";
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

async function buildEmailSingleToolCall(params: {
  message: string;
  normalized: string;
  userId: string;
  emailAccountId: string;
  logger: Logger;
}): Promise<RuntimeSingleToolCall | undefined> {
  const { message, normalized } = params;
  if (!EMAIL_ENTITY_RE.test(normalized)) return undefined;
  if (!LOOKUP_VERB_RE.test(normalized) && !COUNT_RE.test(normalized)) return undefined;

  const sentRequested = SENT_MAILBOX_RE.test(normalized);
  const toolName = sentRequested ? "email.searchSent" : "email.searchInbox";
  const sender = parseSenderScope(message);
  const textScope = parseTextScope(message);
  const attachmentIntentTerm = inferAttachmentIntentTerm(message, textScope);
  const hasAttachment = ATTACHMENT_RE.test(normalized) || Boolean(attachmentIntentTerm);
  const timeZone = await resolveTimeZone(params);
  const dateRange = inferDateRangeFromMessage(normalized, timeZone);

  if (COUNT_RE.test(normalized)) {
    if (UNREAD_RE.test(normalized) && !dateRange && !sentRequested) {
      return {
        toolName: "email.getUnreadCount",
        args: { scope: "inbox" },
        reason: "email_unread_count",
        onFailureText: "I couldn't load your unread email count right now.",
      };
    }

    return {
      toolName,
      args: {
        query: textScope ?? "",
        purpose: "count",
        limit: dateRange ? 5000 : 100,
        fetchAll: Boolean(dateRange),
        ...(dateRange ? { dateRange } : {}),
        ...(sender ? { from: sender } : {}),
        ...(hasAttachment ? { hasAttachment: true } : {}),
        ...(attachmentIntentTerm ? { text: attachmentIntentTerm } : {}),
      },
      reason: sentRequested ? "email_sent_count" : "email_inbox_count",
      onFailureText: "I couldn't count those emails right now.",
    };
  }

  const queryParts: string[] = [];
  if (textScope) queryParts.push(textScope);
  if (attachmentIntentTerm && !textScope) queryParts.push(attachmentIntentTerm);

  return {
    toolName,
    args: {
      query: queryParts.join(" ").trim(),
      purpose: "list",
      limit: dateRange ? 100 : 25,
      fetchAll: false,
      ...(dateRange ? { dateRange } : {}),
      ...(sender ? { from: sender } : {}),
      ...(hasAttachment ? { hasAttachment: true } : {}),
      ...(attachmentIntentTerm ? { text: attachmentIntentTerm } : {}),
    },
    reason: sentRequested ? "email_sent_list" : "email_inbox_list",
    onFailureText: "I couldn't load those emails right now.",
  };
}

function buildCalendarSingleToolCall(message: string): RuntimeSingleToolCall | undefined {
  const normalized = message.toLowerCase();
  if (!CALENDAR_ENTITY_RE.test(normalized)) return undefined;
  if (!LOOKUP_VERB_RE.test(normalized) && !/\bnext\b/u.test(normalized)) return undefined;

  return {
    toolName: "calendar.listEvents",
    args: {
      dateRange: {
        ...( /\bthis month\b/u.test(normalized)
          ? { after: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10), before: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10) }
          : /\btomorrow\b/u.test(normalized)
            ? { after: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10), before: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10) }
            : { after: new Date().toISOString().slice(0, 10), before: new Date().toISOString().slice(0, 10) }),
      },
      limit: 20,
    },
    reason: "calendar_read_window",
    onFailureText: "I couldn't read your calendar right now.",
  };
}

async function compileWithModel(params: {
  message: string;
  userId: string;
  email: string;
  emailAccountId: string;
  logger: Logger;
}): Promise<z.infer<typeof compilerSchema> | null> {
  if (!ENABLE_MODEL_COMPILER) return null;
  if (process.env.RUNTIME_TURN_COMPILER_USE_MODEL === "false") return null;

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
      "You compile a user turn into structured intent.",
      "Return JSON only.",
      "Separate conversational text from executable tasks.",
      "Meta constraints like 'not from conversation memory' are meta constraints, not sender filters.",
      "If unsure, choose planner and set needsClarification=true.",
    ].join("\n"),
    prompt: `User turn: ${params.message}`,
  });

  const timeoutMs = Math.min(
    Math.max(Number.parseInt(process.env.RUNTIME_TURN_COMPILER_TIMEOUT_MS ?? "1200", 10) || 1200, 500),
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
}): Promise<RuntimeCompiledTurn> {
  const message = params.message.trim();
  const normalized = message.toLowerCase();
  const metaConstraints = extractMetaConstraints(normalized);

  const intent = resolveIntent(normalized);
  const complexity = inferComplexity(normalized, intent.action);

  if (GREETING_RE.test(normalized)) {
    return {
      routeHint: "conversation_only",
      conversationClauses: [message],
      taskClauses: [],
      metaConstraints,
      needsClarification: false,
      conversationFallbackText: "Hey. What can I help you with?",
      confidence: 0.98,
      source: "compiler_fallback",
    };
  }

  if (CAPABILITIES_RE.test(normalized)) {
    return {
      routeHint: "conversation_only",
      conversationClauses: [message],
      taskClauses: [],
      metaConstraints,
      needsClarification: false,
      conversationFallbackText: fastCapabilitiesReply(),
      confidence: 0.95,
      source: "compiler_fallback",
    };
  }

  const modelResult = await compileWithModel(params);

  if (intent.domain === "inbox" && intent.action === "read" && complexity !== "complex") {
    const emailCall = await buildEmailSingleToolCall({
      message,
      normalized,
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      logger: params.logger,
    });
    if (emailCall) {
      return {
        routeHint: "single_tool",
        conversationClauses: modelResult?.conversationClauses ?? [],
        taskClauses: [{ domain: "inbox", action: "read", confidence: 0.86 }],
        metaConstraints: [...new Set([...(modelResult?.metaConstraints ?? []), ...metaConstraints])],
        needsClarification: false,
        singleToolCall: emailCall,
        confidence: modelResult?.confidence ?? 0.86,
        source: modelResult ? "compiler_model" : "compiler_fallback",
      };
    }
  }

  if (intent.domain === "calendar" && intent.action === "read" && complexity === "simple") {
    const calendarCall = buildCalendarSingleToolCall(message);
    if (calendarCall) {
      return {
        routeHint: "single_tool",
        conversationClauses: modelResult?.conversationClauses ?? [],
        taskClauses: [{ domain: "calendar", action: "read", confidence: 0.8 }],
        metaConstraints: [...new Set([...(modelResult?.metaConstraints ?? []), ...metaConstraints])],
        needsClarification: false,
        singleToolCall: calendarCall,
        confidence: modelResult?.confidence ?? 0.8,
        source: modelResult ? "compiler_model" : "compiler_fallback",
      };
    }
  }

  const hasDomainSignals = EMAIL_ENTITY_RE.test(normalized) || CALENDAR_ENTITY_RE.test(normalized) || POLICY_ENTITY_RE.test(normalized);
  if (!hasDomainSignals && !MUTATION_VERB_RE.test(normalized) && !LOOKUP_VERB_RE.test(normalized)) {
    return {
      routeHint: "conversation_only",
      conversationClauses: modelResult?.conversationClauses ?? [message],
      taskClauses: [],
      metaConstraints: [...new Set([...(modelResult?.metaConstraints ?? []), ...metaConstraints])],
      needsClarification: false,
      confidence: modelResult?.confidence ?? 0.72,
      source: modelResult ? "compiler_model" : "compiler_fallback",
    };
  }

  return {
    routeHint: modelResult?.routeHint ?? "planner",
    conversationClauses: modelResult?.conversationClauses ?? [],
    taskClauses:
      modelResult?.taskClauses.length && modelResult.taskClauses.length > 0
        ? modelResult.taskClauses
        : [{ domain: intent.domain, action: intent.action, confidence: 0.66 }],
    metaConstraints: [...new Set([...(modelResult?.metaConstraints ?? []), ...metaConstraints])],
    needsClarification: modelResult?.needsClarification ?? false,
    confidence: modelResult?.confidence ?? 0.66,
    source: modelResult ? "compiler_model" : "compiler_fallback",
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
