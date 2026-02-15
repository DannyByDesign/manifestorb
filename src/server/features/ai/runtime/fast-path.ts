import { toZonedTime } from "date-fns-tz";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
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
    };

const MUTATION_VERB_RE =
  /\b(create|update|edit|change|delete|remove|archive|trash|send|reply|move|label|reschedule|book|cancel|block|unsubscribe|mark)\b/u;
const EMAIL_ENTITY_RE = /\b(email|emails|inbox|message|messages|thread|threads)\b/u;
const CALENDAR_ENTITY_RE = /\b(calendar|meeting|meetings|event|events|schedule)\b/u;
const FIRST_OR_LATEST_RE = /\b(first|top|latest|most recent|newest|recent)\b/u;
const UNREAD_OR_ATTENTION_RE =
  /\b(unread|need attention|needs attention|respond to|reply to|priority)\b/u;
const LIST_OR_SHOW_RE = /\b(show|list|check|find|what|which|tell me)\b/u;
const GREETING_RE =
  /^(hi|hello|hey|yo|sup|good morning|good afternoon|good evening|howdy)[\s!.?]*$/u;
const CAPABILITIES_RE =
  /\b(what can you do|capabilit(?:y|ies)|how can you help|what do you do|help me understand)\b/u;
const COUNT_RE = /\b(how many|count|number of)\b/u;
const EXPLICIT_DATE_RANGE_RE =
  /\b(today|tonight|tomorrow|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/u;
const LIST_LIKE_EMAIL_RE = /\b(emails|messages|threads|alerts|updates)\b/u;
const ATTENTION_HEURISTIC_RE =
  /\b(need attention|needs attention|respond to|reply to|priority)\b/u;
const RULE_ENTITY_RE = /\b(rule|rules|automation|automations|policy|policies)\b/u;
const RULE_LIST_RE = /\b(list|show|what are|what's|which)\b/u;
const RULE_CREATE_RE = /\b(create|add|set up|setup|make)\b/u;
const RULE_DISABLE_RE = /\b(disable|pause|turn off|deactivate)\b/u;
const RULE_DELETE_RE = /\b(delete|remove)\b/u;
const RULE_ID_RE = /\b(?:rule|id)\s*(?:is\s*)?([a-z0-9][a-z0-9_-]{5,})\b/iu;

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

function firstArrayItem(value: unknown): Record<string, unknown> | null {
  const item = asArray(value)[0];
  return asRecord(item);
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
  const totalEstimateRaw = paging?.totalEstimate;
  const totalEstimate =
    typeof totalEstimateRaw === "number" && Number.isFinite(totalEstimateRaw)
      ? Math.max(0, Math.trunc(totalEstimateRaw))
      : null;

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
  if (items.length <= 3) {
    if (!isTruncated) return `Top ${items.length} emails: ${top.join("; ")}.`;
    if (totalEstimate !== null && totalEstimate > items.length) {
      return `I can see about ${totalEstimate} matching emails. Top ones: ${top.join("; ")}.`;
    }
    return `I can see at least ${items.length} emails. Top ones: ${top.join("; ")}.`;
  }
  if (!isTruncated) return `I found ${items.length} matches. Top ones: ${top.join("; ")}.`;
  if (totalEstimate !== null && totalEstimate > items.length) {
    return `I can see about ${totalEstimate} matches. Top ones: ${top.join("; ")}.`;
  }
  return `I can see at least ${items.length} matches. Top ones: ${top.join("; ")}.`;
  };
}

function summarizeEmailCount(params: {
  unreadOnly: boolean;
  hasDateRange: boolean;
}) {
  return (result: RuntimeToolResult): string => {
    const items = asArray(result.data);
    const count = items.length;
    const qualifier = params.unreadOnly ? "unread emails" : "emails";
    if (params.hasDateRange) {
      return `You have ${count} ${qualifier} in that date window.`;
    }
    return `You have ${count} ${qualifier}.`;
  };
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

function summarizeRuleList(): (result: RuntimeToolResult) => string {
  return (result: RuntimeToolResult): string => {
    const items = asArray(result.data).map((item) => asRecord(item)).filter(Boolean);
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
    "I can read and summarize email, find priority items, draft or send replies (with approval when needed), and manage labels or rules.",
    "I can review your schedule, find availability, create/reschedule/cancel events, and manage calendar policies like focus blocks or out-of-office.",
  ].join(" ");
}

async function inferCalendarFastPath(
  session: RuntimeSession,
  normalized: string,
): Promise<RuntimeFastPathMatch | null> {
  if (!CALENDAR_ENTITY_RE.test(normalized)) return null;
  if (!LIST_OR_SHOW_RE.test(normalized)) return null;
  if (isMutatingRequest(normalized)) return null;

  return buildCalendarReadFastPath({
    session,
    normalized,
    reason: "calendar_read_window",
  });
}

async function buildCalendarReadFastPath(params: {
  session: RuntimeSession;
  normalized: string;
  reason: string;
}): Promise<RuntimeFastPathMatch | null> {
  const { session, normalized, reason } = params;
  const tz = await resolveDefaultCalendarTimeZone({
    userId: session.input.userId,
    emailAccountId: session.input.emailAccountId,
  });
  if ("error" in tz) return null;

  const dateRange = inferCalendarDateRange(normalized, tz.timeZone);
  return {
    type: "tool_call",
    toolName: "calendar.listEvents",
    args: { dateRange, limit: 20 },
    reason,
    summarize: summarizeCalendarList(tz.timeZone),
    onFailureText: "I couldn't read your calendar right now. Please try again in a moment.",
  };
}

async function buildCalendarCountFastPath(params: {
  session: RuntimeSession;
  normalized: string;
  reason: string;
}): Promise<RuntimeFastPathMatch | null> {
  const { session, normalized, reason } = params;
  const tz = await resolveDefaultCalendarTimeZone({
    userId: session.input.userId,
    emailAccountId: session.input.emailAccountId,
  });
  if ("error" in tz) return null;

  const dateRange = inferExplicitDateRange(normalized, tz.timeZone);
  if (!dateRange) return null;

  return {
    type: "tool_call",
    toolName: "calendar.listEvents",
    args: { dateRange },
    reason,
    summarize: summarizeCalendarCount(),
    onFailureText: "I couldn't read your calendar right now. Please try again in a moment.",
  };
}

async function resolveFastPathTimeZone(session: RuntimeSession): Promise<string> {
  const tz = await resolveDefaultCalendarTimeZone({
    userId: session.input.userId,
    emailAccountId: session.input.emailAccountId,
  });
  if ("error" in tz) return "UTC";
  return tz.timeZone;
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

  if (RULE_ENTITY_RE.test(normalized) && RULE_LIST_RE.test(normalized) && !isMutatingRequest(normalized)) {
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
    return {
      type: "tool_call",
      toolName: "policy.createRule",
      args: {
        input: session.input.message,
        activate: true,
      },
      reason: "policy_create_rule",
      summarize: (result) =>
        asString(result.message) ??
        "I submitted that rule request.",
      onFailureText: "I couldn't create that rule right now. Please try again.",
    };
  }

  if (RULE_ENTITY_RE.test(normalized) && (RULE_DISABLE_RE.test(normalized) || RULE_DELETE_RE.test(normalized))) {
    const match = normalized.match(RULE_ID_RE);
    const ruleId = match?.[1];
    if (!ruleId) {
      return {
        type: "respond",
        reason: "policy_missing_rule_id",
        text: "I can do that, but I need the rule id. Say: disable rule <id> or delete rule <id>.",
      };
    }

    const isDelete = RULE_DELETE_RE.test(normalized);
    return {
      type: "tool_call",
      toolName: isDelete ? "policy.deleteRule" : "policy.disableRule",
      args: { id: ruleId },
      reason: isDelete ? "policy_delete_rule" : "policy_disable_rule",
      summarize: (result) =>
        asString(result.message) ?? (isDelete ? "Rule deleted." : "Rule disabled."),
      onFailureText: isDelete
        ? "I couldn't delete that rule right now. Please try again."
        : "I couldn't disable that rule right now. Please try again.",
    };
  }

  if (!isMutatingRequest(normalized) && EMAIL_ENTITY_RE.test(normalized) && FIRST_OR_LATEST_RE.test(normalized)) {
    const timeZone = await resolveFastPathTimeZone(session);
    return {
      type: "tool_call",
      toolName: "email.searchInbox",
      args: { limit: 1, fetchAll: false },
      reason: "email_first_or_latest",
      summarize: summarizeTopEmail(timeZone),
      onFailureText: "I couldn't load your inbox right now. Please try again in a moment.",
    };
  }

  if (!isMutatingRequest(normalized) && EMAIL_ENTITY_RE.test(normalized) && COUNT_RE.test(normalized)) {
    const timeZone = await resolveFastPathTimeZone(session);
    const dateRange = inferExplicitDateRange(normalized, timeZone);
    const unreadOnly = /\bunread\b/u.test(normalized);
    if (!unreadOnly && !dateRange) return null;
    return {
      type: "tool_call",
      toolName: "email.searchInbox",
      args: {
        query: unreadOnly ? "is:unread" : "",
        limit: 2000,
        fetchAll: true,
        ...(dateRange ? { dateRange } : {}),
      },
      reason: "email_count",
      summarize: summarizeEmailCount({
        unreadOnly,
        hasDateRange: Boolean(dateRange),
      }),
      onFailureText: "I couldn't load inbox messages right now. Please try again in a moment.",
      requireCompleteResult: true,
    };
  }

  if (
    !isMutatingRequest(normalized) &&
    EMAIL_ENTITY_RE.test(normalized) &&
    LIST_OR_SHOW_RE.test(normalized) &&
    !COUNT_RE.test(normalized) &&
    !ATTENTION_HEURISTIC_RE.test(normalized)
  ) {
    const timeZone = await resolveFastPathTimeZone(session);
    const dateRange = inferExplicitDateRange(normalized, timeZone);
    const query = /\bunread\b/u.test(normalized) ? "is:unread" : "";
    return {
      type: "tool_call",
      toolName: "email.searchInbox",
      args: {
        query,
        fetchAll: Boolean(dateRange),
        ...(dateRange ? { dateRange } : {}),
      },
      reason: "email_read_list",
      summarize: summarizeEmailList(timeZone),
      onFailureText: "I couldn't load inbox messages right now. Please try again in a moment.",
    };
  }

  if (!isMutatingRequest(normalized) && CALENDAR_ENTITY_RE.test(normalized) && COUNT_RE.test(normalized)) {
    const calendarCount = await buildCalendarCountFastPath({
      session,
      normalized,
      reason: "calendar_count_window",
    });
    if (calendarCount) return calendarCount;
  }

  const calendarMatch = await inferCalendarFastPath(session, normalized);
  if (calendarMatch) return calendarMatch;

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
