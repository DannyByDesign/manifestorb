import { toZonedTime } from "date-fns-tz";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
import type { RuntimeSemanticIntent } from "@/server/features/ai/runtime/semantic-contract";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";

export type RuntimeFastPathMode = "strict" | "recovery";

export type RuntimeFastPathMatch =
  | {
      type: "respond";
      text: string;
      reason: string;
    }
  | {
      type: "tool_call";
      toolName: string;
      args: Record<string, unknown>;
      reason: string;
      summarize: (result: RuntimeToolResult) => string;
      onFailureText: string;
      requireCompleteResult?: boolean;
      allowEstimatedTotalWhenTruncated?: boolean;
    };

const FAST_PATH_MIN_CONFIDENCE = 0.78;
const FAST_PATH_MIN_MARGIN = 0.025;

const MUTATION_VERB_RE =
  /\b(create|update|edit|change|delete|remove|archive|trash|send|reply|move|label|reschedule|book|cancel|block|unsubscribe|mark)\b/u;
const CONDITIONAL_OR_CHAINING_RE =
  /\b(if|unless|otherwise|except|only if|when|and then|follow(?:ed)? by|after that|before that|next step)\b/u;
const EMAIL_ENTITY_RE = /\b(email|emails|inbox|message|messages|thread|threads)\b/u;
const CALENDAR_ENTITY_RE = /\b(calendar|meeting|meetings|event|events|schedule)\b/u;
const FIRST_OR_LATEST_RE = /\b(first|top|latest|most recent|newest|recent)\b/u;
const LIST_OR_SHOW_RE = /\b(show|list|check|find|search|what|which|tell me)\b/u;
const SENT_MAILBOX_RE =
  /\b(?:my\s+)?sent\s+(?:emails?|messages?|mail|threads?)\b|\bsent\s+mailbox\b|\boutbox\b/u;
const GREETING_RE =
  /^(hi|hello|hey|yo|sup|good morning|good afternoon|good evening|howdy)[\s!.?]*$/u;
const CAPABILITIES_RE =
  /\b(what can you do|capabilit(?:y|ies)|how can you help|what do you do|help me understand)\b/u;
const COUNT_RE = /\b(how many|count|number of)\b/u;
const UNREAD_RE = /\bunread\b/u;
const ATTENTION_HEURISTIC_RE =
  /\b(need attention|needs attention|respond to|reply to|priority|important)\b/u;
const EXPLICIT_DATE_RANGE_RE =
  /\b(today|tonight|tomorrow|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/u;
const RULE_ENTITY_RE = /\b(rule|rules|automation|automations|policy|policies)\b/u;
const RULE_LIST_RE = /\b(list|show|what are|what's|which)\b/u;
const RULE_CREATE_RE = /\b(create|add|set up|setup|make)\b/u;
const NEXT_MEETING_RE = /\b(next\s+(meeting|event)|what'?s\s+next\s+on\s+my\s+calendar)\b/u;
const MEETING_NOW_RE = /\b(am i in (a )?meeting right now|do i have (a )?meeting right now|meeting right now)\b/u;
const EMAIL_SENDER_SCOPE_RE =
  /\b(?:from|by)\s+([^,.!?]+?)(?=\s+(?:today|tonight|tomorrow|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|$)/iu;
const EMAIL_TOPIC_SCOPE_RE =
  /\b(?:about|regarding|re:)\s+([^,.!?]+?)(?=\s+(?:today|tonight|tomorrow|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|$)/iu;
const EMAIL_TEXT_SCOPE_RE =
  /\bfor\s+([^,.!?]+?)(?=\s+(?:today|tonight|tomorrow|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|$)/iu;
const EMAIL_QUOTED_TEXT_SCOPE_RE = /(?:^|\s)["'“”]([^"'“”]{2,})["'“”](?:$|\s|[,.!?])/u;

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function isMutatingRequest(message: string): boolean {
  return MUTATION_VERB_RE.test(message);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function firstArrayItem(value: unknown): Record<string, unknown> | null {
  const item = asArray(value)[0];
  return asRecord(item);
}

function normalizeScopeValue(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value || value.length < 2) return undefined;
  return value;
}

function parseSenderScope(message: string): string | undefined {
  const match = message.match(EMAIL_SENDER_SCOPE_RE);
  return normalizeScopeValue(match?.[1]);
}

function parseTopicScope(message: string): string | undefined {
  const match = message.match(EMAIL_TOPIC_SCOPE_RE);
  return normalizeScopeValue(match?.[1]);
}

function parseTextScope(message: string): string | undefined {
  const quoted = normalizeScopeValue(message.match(EMAIL_QUOTED_TEXT_SCOPE_RE)?.[1]);
  if (quoted) return quoted;

  const scoped = normalizeScopeValue(message.match(EMAIL_TEXT_SCOPE_RE)?.[1]);
  if (!scoped) return undefined;
  if (/^(?:me|myself|us|ourselves)$/iu.test(scoped)) return undefined;
  return scoped;
}

function semanticAdmitsIntents(
  session: RuntimeSession,
  intents: RuntimeSemanticIntent[],
): boolean {
  const semantic = session.semantic;
  if (!intents.includes(semantic.intent)) return false;

  if (semantic.source === "embedding") {
    if (semantic.confidence < FAST_PATH_MIN_CONFIDENCE) return false;
    const margin = semantic.classifier?.margin;
    if (typeof margin === "number" && Number.isFinite(margin) && margin < FAST_PATH_MIN_MARGIN) {
      return false;
    }
  }

  return true;
}

function summarizeTopEmail(timeZone: string) {
  return (result: RuntimeToolResult): string => {
    const top = firstArrayItem(result.data);
    if (!top) return "You're clear right now. Nothing is waiting in your inbox.";

    const subject = asString(top.title) ?? "No subject";
    const from = asString(top.from) ?? "unknown sender";
    const localDate = asString(top.dateLocal);
    const date = asString(top.date);
    const receivedAt = localDate ?? (date ? formatInTimeZone(date, timeZone) : null);
    const receivedText = receivedAt ? `, received ${receivedAt}` : "";
    return `Your newest inbox email is "${subject}" from ${from}${receivedText}.`;
  };
}

function summarizeEmailList(timeZone: string) {
  return (result: RuntimeToolResult): string => {
    const items = asArray(result.data).map((item) => asRecord(item)).filter(Boolean) as Record<
      string,
      unknown
    >[];
    if (items.length === 0) return "I don't see matching emails right now.";

    const isTruncated = result.truncated === true;
    const paging = asRecord(result.paging);
    const totalEstimate = asNumber(paging?.totalEstimate);

    const top = items.slice(0, 3).map((item) => {
      const subject = asString(item.title) ?? "No subject";
      const from = asString(item.from) ?? "unknown sender";
      const localDate = asString(item.dateLocal);
      const date = asString(item.date);
      const receivedAt = localDate ?? (date ? formatInTimeZone(date, timeZone) : null);
      return receivedAt
        ? `"${subject}" from ${from} (${receivedAt})`
        : `"${subject}" from ${from}`;
    });

    if (items.length === 1) return `I found one: ${top[0]}.`;
    if (items.length <= 3 && !isTruncated) return `Top ${items.length} emails: ${top.join("; ")}.`;

    if (isTruncated && totalEstimate !== null && totalEstimate > items.length) {
      return `I found roughly ${totalEstimate} matching emails. Top ones: ${top.join("; ")}.`;
    }

    if (isTruncated) {
      return `I found at least ${items.length} matching emails. Top ones: ${top.join("; ")}.`;
    }

    return `I found ${items.length} matching emails. Top ones: ${top.join("; ")}.`;
  };
}

function summarizeEmailCount(params: {
  unreadOnly: boolean;
  hasDateRange: boolean;
  allowEstimatedTotalWhenTruncated: boolean;
}) {
  return (result: RuntimeToolResult): string => {
    const items = asArray(result.data);
    const paging = asRecord(result.paging);
    const totalEstimate = asNumber(paging?.totalEstimate);
    const isTruncated = result.truncated === true;

    const qualifier = params.unreadOnly ? "unread emails" : "emails";
    const windowText = params.hasDateRange ? " in that date window" : "";

    if (
      isTruncated &&
      params.allowEstimatedTotalWhenTruncated &&
      totalEstimate !== null &&
      totalEstimate >= 0
    ) {
      return `You have about ${totalEstimate} ${qualifier}${windowText}.`;
    }

    return `You have ${items.length} ${qualifier}${windowText}.`;
  };
}

function summarizeUnreadCount(result: RuntimeToolResult): string {
  const payload = asRecord(result.data);
  const count = Math.max(0, asNumber(payload?.count) ?? 0);
  const exact = payload?.exact === true;
  if (exact) {
    return `You have ${count} unread emails right now.`;
  }
  return `You have about ${count} unread emails right now.`;
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

function inferCalendarDateRange(message: string, timeZone: string): {
  after: string;
  before: string;
} {
  const nowLocal = toZonedTime(new Date(), timeZone);
  const today = startOfLocalDay(nowLocal);
  const normalized = message.toLowerCase();

  if (/\btomorrow\b/u.test(normalized)) {
    const day = addLocalDays(today, 1);
    const ymd = formatLocalYmd(day);
    return { after: ymd, before: ymd };
  }

  if (/\bthis week\b/u.test(normalized)) {
    const dayOfWeek = today.getDay();
    const end = addLocalDays(today, 6 - dayOfWeek);
    return {
      after: formatLocalYmd(today),
      before: formatLocalYmd(end),
    };
  }

  if (/\bnext week\b/u.test(normalized)) {
    const dayOfWeek = today.getDay();
    const daysUntilNextMonday = ((8 - dayOfWeek) % 7) || 7;
    const start = addLocalDays(today, daysUntilNextMonday);
    const end = addLocalDays(start, 6);
    return {
      after: formatLocalYmd(start),
      before: formatLocalYmd(end),
    };
  }

  const weekdayMatch = normalized.match(
    /\b(?:(this|next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/u,
  );
  if (weekdayMatch) {
    const modifier = weekdayMatch[1] ?? "";
    const weekday = weekdayMatch[2] ?? "";
    const targetDay = WEEKDAY_INDEX[weekday];
    if (typeof targetDay === "number") {
      const todayDay = today.getDay();
      let delta = (targetDay - todayDay + 7) % 7;
      if (modifier === "next" || (modifier === "" && delta === 0)) delta += 7;
      const day = addLocalDays(today, delta);
      const ymd = formatLocalYmd(day);
      return { after: ymd, before: ymd };
    }
  }

  const ymd = formatLocalYmd(today);
  return { after: ymd, before: ymd };
}

function inferFutureCalendarDateRange(timeZone: string): {
  after: string;
  before: string;
} {
  const nowLocal = toZonedTime(new Date(), timeZone);
  const today = startOfLocalDay(nowLocal);
  const end = addLocalDays(today, 7);
  return {
    after: formatLocalYmd(today),
    before: formatLocalYmd(end),
  };
}

function inferExplicitDateRange(
  message: string,
  timeZone: string,
): { after: string; before: string } | null {
  if (!EXPLICIT_DATE_RANGE_RE.test(message)) return null;
  return inferCalendarDateRange(message, timeZone);
}

function formatInTimeZone(isoOrDate: string, timeZone: string): string {
  const parsed = new Date(isoOrDate);
  if (Number.isNaN(parsed.getTime())) return isoOrDate;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function summarizeCalendarList(timeZone: string) {
  return (result: RuntimeToolResult): string => {
    const items = asArray(result.data).map((item) => asRecord(item)).filter(Boolean) as Record<
      string,
      unknown
    >[];

    if (items.length === 0) return "No calendar events found in that window.";

    const top = items.slice(0, 3).map((item) => {
      const title = asString(item.title) ?? "Untitled event";
      const startLocal = asString(item.startLocal);
      const start = asString(item.start);
      const when = startLocal ?? (start ? formatInTimeZone(start, timeZone) : null);
      return when ? `"${title}" at ${when}` : `"${title}"`;
    });

    if (items.length === 1) return `You have 1 event: ${top[0]}.`;
    if (items.length <= 3) return `You have ${items.length} events: ${top.join("; ")}.`;
    return `You have ${items.length} events. First ones: ${top.join("; ")}.`;
  };
}

function summarizeCalendarCount(): (result: RuntimeToolResult) => string {
  return (result: RuntimeToolResult): string => {
    const items = asArray(result.data);
    return `You have ${items.length} calendar event${items.length === 1 ? "" : "s"} in that date window.`;
  };
}

function summarizeNextMeeting(timeZone: string): (result: RuntimeToolResult) => string {
  return (result: RuntimeToolResult): string => {
    const items = asArray(result.data).map((item) => asRecord(item)).filter(Boolean) as Record<
      string,
      unknown
    >[];
    if (items.length === 0) return "You have no upcoming meetings in the next week.";

    const nowMs = Date.now();
    const sorted = [...items]
      .map((item) => ({
        item,
        startMs: Date.parse(asString(item.start) ?? ""),
      }))
      .filter((entry) => Number.isFinite(entry.startMs))
      .sort((a, b) => a.startMs - b.startMs);

    const next = sorted.find((entry) => entry.startMs >= nowMs) ?? sorted[0];
    if (!next) return "You have no upcoming meetings in the next week.";

    const title = asString(next.item.title) ?? "Untitled event";
    const startLocal = asString(next.item.startLocal);
    const start = asString(next.item.start);
    const when = startLocal ?? (start ? formatInTimeZone(start, timeZone) : "soon");
    return `Your next meeting is "${title}" at ${when}.`;
  };
}

function summarizeMeetingNow(timeZone: string): (result: RuntimeToolResult) => string {
  return (result: RuntimeToolResult): string => {
    const items = asArray(result.data).map((item) => asRecord(item)).filter(Boolean) as Record<
      string,
      unknown
    >[];
    if (items.length === 0) return "You're not in a meeting right now.";

    const nowMs = Date.now();
    const current = items.find((item) => {
      const startMs = Date.parse(asString(item.start) ?? "");
      const endMs = Date.parse(asString(item.end) ?? "");
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
      return startMs <= nowMs && nowMs < endMs;
    });

    if (!current) return "You're not in a meeting right now.";

    const title = asString(current.title) ?? "Untitled event";
    const endLocal = asString(current.endLocal);
    const end = asString(current.end);
    const until = endLocal ?? (end ? formatInTimeZone(end, timeZone) : null);
    if (until) return `Yes. You're currently in "${title}" until ${until}.`;
    return `Yes. You're currently in "${title}".`;
  };
}

function summarizeRuleList(): (result: RuntimeToolResult) => string {
  return (result: RuntimeToolResult): string => {
    const items = asArray(result.data)
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    if (items.length === 0) return "You don't have any rules set up right now.";
    const preview = items.slice(0, 3).map((item) => {
      const name = asString(item.name) ?? asString(item.id) ?? "unnamed rule";
      const type = asString(item.type);
      return type ? `${name} (${type})` : name;
    });
    if (items.length <= 3) {
      return `You have ${items.length} rule${items.length === 1 ? "" : "s"}: ${preview.join("; ")}.`;
    }
    return `You have ${items.length} rules. First ones: ${preview.join("; ")}.`;
  };
}

function fastCapabilitiesReply(): string {
  return [
    "I can handle your inbox and calendar.",
    "I can read and summarize email, find important items, draft or send replies (with approval when needed), and manage labels or rules.",
    "I can review your schedule, find availability, create/reschedule/cancel events, and manage calendar guardrails like focus blocks or out-of-office.",
  ].join(" ");
}

async function resolveFastPathTimeZone(session: RuntimeSession): Promise<string> {
  const tz = await resolveDefaultCalendarTimeZone({
    userId: session.input.userId,
    emailAccountId: session.input.emailAccountId,
  });
  if ("error" in tz) return "UTC";
  return tz.timeZone;
}

function hasTool(session: RuntimeSession, toolName: string): boolean {
  return session.toolLookup.has(toolName);
}

function buildEmailFirstFastPath(params: {
  session: RuntimeSession;
  normalized: string;
  timeZone: string;
}): RuntimeFastPathMatch | null {
  const { session, normalized, timeZone } = params;
  if (!semanticAdmitsIntents(session, ["inbox_read"])) return null;
  if (!EMAIL_ENTITY_RE.test(normalized)) return null;
  if (!FIRST_OR_LATEST_RE.test(normalized)) return null;
  if (!hasTool(session, "email.searchInbox")) return null;

  return {
    type: "tool_call",
    toolName: "email.searchInbox",
    args: { limit: 1, fetchAll: false, purpose: "lookup" },
    reason: "email_first_or_latest",
    summarize: summarizeTopEmail(timeZone),
    onFailureText: "I couldn't load your inbox right now. Please try again in a moment.",
  };
}

function buildEmailCountFastPath(params: {
  session: RuntimeSession;
  normalized: string;
  timeZone: string;
}): RuntimeFastPathMatch | null {
  const { session, normalized, timeZone } = params;
  if (!semanticAdmitsIntents(session, ["inbox_read", "inbox_attention"])) return null;
  if (!EMAIL_ENTITY_RE.test(normalized)) return null;
  if (!COUNT_RE.test(normalized)) return null;
  if (!hasTool(session, "email.searchInbox")) return null;

  const dateRange = inferExplicitDateRange(normalized, timeZone);
  const unreadOnly = UNREAD_RE.test(normalized);
  if (!unreadOnly && !dateRange) return null;

  if (unreadOnly && !dateRange && hasTool(session, "email.getUnreadCount")) {
    return {
      type: "tool_call",
      toolName: "email.getUnreadCount",
      args: { scope: "inbox" },
      reason: "email_unread_count_exact",
      summarize: summarizeUnreadCount,
      onFailureText: "I couldn't load your unread email count right now. Please try again in a moment.",
    };
  }

  const allowEstimatedTotalWhenTruncated = unreadOnly && !dateRange;
  return {
    type: "tool_call",
    toolName: "email.searchInbox",
    args: {
      query: unreadOnly ? "is:unread" : "",
      purpose: "count",
      limit: allowEstimatedTotalWhenTruncated ? 100 : 5000,
      fetchAll: !allowEstimatedTotalWhenTruncated,
      ...(dateRange ? { dateRange } : {}),
    },
    reason: "email_count",
    summarize: summarizeEmailCount({
      unreadOnly,
      hasDateRange: Boolean(dateRange),
      allowEstimatedTotalWhenTruncated,
    }),
    onFailureText: "I couldn't load inbox messages right now. Please try again in a moment.",
    requireCompleteResult: true,
    allowEstimatedTotalWhenTruncated,
  };
}

function buildEmailListFastPath(params: {
  session: RuntimeSession;
  normalized: string;
  timeZone: string;
}): RuntimeFastPathMatch | null {
  const { session, normalized, timeZone } = params;
  if (!semanticAdmitsIntents(session, ["inbox_read"])) return null;
  if (!EMAIL_ENTITY_RE.test(normalized)) return null;
  if (!LIST_OR_SHOW_RE.test(normalized)) return null;
  if (COUNT_RE.test(normalized)) return null;
  if (ATTENTION_HEURISTIC_RE.test(normalized)) return null;

  const sentMailboxRequested = SENT_MAILBOX_RE.test(normalized);
  const hasSentTool = hasTool(session, "email.searchSent");
  const hasInboxTool = hasTool(session, "email.searchInbox");
  if (!hasSentTool && !hasInboxTool) return null;
  if (!sentMailboxRequested && !hasInboxTool) return null;

  const toolName: "email.searchSent" | "email.searchInbox" =
    sentMailboxRequested && hasSentTool ? "email.searchSent" : "email.searchInbox";

  const dateRange = inferExplicitDateRange(normalized, timeZone);
  const unreadOnly = UNREAD_RE.test(normalized);
  const sender = parseSenderScope(session.input.message);
  const topic = parseTopicScope(session.input.message);
  const textScope = parseTextScope(session.input.message);

  if ((sender || topic) && !dateRange) return null;

  const queryParts: string[] = [];
  if (unreadOnly) queryParts.push("is:unread");
  if (textScope) queryParts.push(textScope);
  const query = queryParts.join(" ").trim();

  const args: Record<string, unknown> = {
    query,
    purpose: "list",
    limit: dateRange ? 100 : unreadOnly ? 50 : 25,
    fetchAll: false,
    ...(dateRange ? { dateRange } : {}),
    ...(sentMailboxRequested && toolName === "email.searchInbox" ? { sentByMe: true } : {}),
    ...(sender ? { from: sender } : {}),
    ...(topic ? { text: topic } : {}),
  };

  return {
    type: "tool_call",
    toolName,
    args,
    reason: sentMailboxRequested ? "email_read_list_sent" : "email_read_list",
    summarize: summarizeEmailList(timeZone),
    onFailureText: "I couldn't load email messages right now. Please try again in a moment.",
  };
}

function buildCalendarCountFastPath(params: {
  session: RuntimeSession;
  normalized: string;
  timeZone: string;
}): RuntimeFastPathMatch | null {
  const { session, normalized, timeZone } = params;
  if (!semanticAdmitsIntents(session, ["calendar_read"])) return null;
  if (!CALENDAR_ENTITY_RE.test(normalized)) return null;
  if (!COUNT_RE.test(normalized)) return null;
  if (!hasTool(session, "calendar.listEvents")) return null;

  const dateRange = inferExplicitDateRange(normalized, timeZone);
  if (!dateRange) return null;

  return {
    type: "tool_call",
    toolName: "calendar.listEvents",
    args: { dateRange },
    reason: "calendar_count_window",
    summarize: summarizeCalendarCount(),
    onFailureText: "I couldn't read your calendar right now. Please try again in a moment.",
  };
}

function buildCalendarReadFastPath(params: {
  session: RuntimeSession;
  normalized: string;
  timeZone: string;
}): RuntimeFastPathMatch | null {
  const { session, normalized, timeZone } = params;
  if (!semanticAdmitsIntents(session, ["calendar_read"])) return null;
  if (!CALENDAR_ENTITY_RE.test(normalized)) return null;
  if (!LIST_OR_SHOW_RE.test(normalized)) return null;
  if (!hasTool(session, "calendar.listEvents")) return null;

  return {
    type: "tool_call",
    toolName: "calendar.listEvents",
    args: { dateRange: inferCalendarDateRange(normalized, timeZone), limit: 20 },
    reason: "calendar_read_window",
    summarize: summarizeCalendarList(timeZone),
    onFailureText: "I couldn't read your calendar right now. Please try again in a moment.",
  };
}

function buildNextMeetingFastPath(params: {
  session: RuntimeSession;
  normalized: string;
  timeZone: string;
}): RuntimeFastPathMatch | null {
  const { session, normalized, timeZone } = params;
  if (!semanticAdmitsIntents(session, ["calendar_read"])) return null;
  if (!CALENDAR_ENTITY_RE.test(normalized)) return null;
  if (!NEXT_MEETING_RE.test(normalized)) return null;
  if (!hasTool(session, "calendar.listEvents")) return null;

  return {
    type: "tool_call",
    toolName: "calendar.listEvents",
    args: { dateRange: inferFutureCalendarDateRange(timeZone), limit: 20 },
    reason: "calendar_next_meeting",
    summarize: summarizeNextMeeting(timeZone),
    onFailureText: "I couldn't read your calendar right now. Please try again in a moment.",
  };
}

function buildMeetingNowFastPath(params: {
  session: RuntimeSession;
  normalized: string;
  timeZone: string;
}): RuntimeFastPathMatch | null {
  const { session, normalized, timeZone } = params;
  if (!semanticAdmitsIntents(session, ["calendar_read"])) return null;
  if (!CALENDAR_ENTITY_RE.test(normalized)) return null;
  if (!MEETING_NOW_RE.test(normalized)) return null;
  if (!hasTool(session, "calendar.listEvents")) return null;

  return {
    type: "tool_call",
    toolName: "calendar.listEvents",
    args: { dateRange: inferCalendarDateRange("today", timeZone), limit: 50 },
    reason: "calendar_meeting_now",
    summarize: summarizeMeetingNow(timeZone),
    onFailureText: "I couldn't read your calendar right now. Please try again in a moment.",
  };
}

export async function matchRuntimeFastPath(params: {
  session: RuntimeSession;
  mode: RuntimeFastPathMode;
}): Promise<RuntimeFastPathMatch | null> {
  const { session, mode } = params;
  const normalized = session.input.message.trim().toLowerCase();
  if (!normalized) return null;

  if (GREETING_RE.test(normalized)) {
    return {
      type: "respond",
      reason: "greeting",
      text: "Hey. What can I help you with?",
    };
  }

  if (CAPABILITIES_RE.test(normalized)) {
    return {
      type: "respond",
      reason: "capabilities",
      text: fastCapabilitiesReply(),
    };
  }

  if (CONDITIONAL_OR_CHAINING_RE.test(normalized)) {
    return null;
  }

  if (RULE_ENTITY_RE.test(normalized) && RULE_LIST_RE.test(normalized) && !isMutatingRequest(normalized)) {
    if (!semanticAdmitsIntents(session, ["policy_controls", "cross_surface_plan"])) return null;
    if (!hasTool(session, "policy.listRules")) return null;

    const type =
      /\bguardrail/.test(normalized)
        ? "guardrail"
        : /\bautomation/.test(normalized)
          ? "automation"
          : /\bpreference/.test(normalized)
            ? "preference"
            : undefined;
    return {
      type: "tool_call",
      toolName: "policy.listRules",
      args: type ? { type } : {},
      reason: "policy_list_rules",
      summarize: summarizeRuleList(),
      onFailureText: "I couldn't load your rules right now. Please try again in a moment.",
    };
  }

  if (RULE_ENTITY_RE.test(normalized) && RULE_CREATE_RE.test(normalized)) {
    if (!semanticAdmitsIntents(session, ["policy_controls", "cross_surface_plan"])) return null;
    if (!hasTool(session, "policy.createRule")) return null;

    return {
      type: "tool_call",
      toolName: "policy.createRule",
      args: {
        input: session.input.message,
        activate: true,
      },
      reason: "policy_create_rule",
      summarize: (result) => asString(result.message) ?? "I submitted that rule request.",
      onFailureText: "I couldn't create that rule right now. Please try again.",
    };
  }

  if (
    ATTENTION_HEURISTIC_RE.test(normalized) &&
    EMAIL_ENTITY_RE.test(normalized) &&
    !COUNT_RE.test(normalized)
  ) {
    return null;
  }

  const timeZone = await resolveFastPathTimeZone(session);

  const operations = [
    buildEmailFirstFastPath({ session, normalized, timeZone }),
    buildEmailCountFastPath({ session, normalized, timeZone }),
    buildEmailListFastPath({ session, normalized, timeZone }),
    buildMeetingNowFastPath({ session, normalized, timeZone }),
    buildNextMeetingFastPath({ session, normalized, timeZone }),
    buildCalendarCountFastPath({ session, normalized, timeZone }),
    buildCalendarReadFastPath({ session, normalized, timeZone }),
  ];

  for (const operation of operations) {
    if (operation) return operation;
  }

  if (mode === "strict") return null;

  if (isMutatingRequest(normalized)) {
    return {
      type: "respond",
      reason: "recovery_mutation_clarify",
      text: "I can do that, but I need one concrete target first. Tell me exactly which email or event to act on.",
    };
  }

  return null;
}
