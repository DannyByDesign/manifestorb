import { z } from "zod";
import type { Logger } from "@/server/lib/logger";
import type { SkillContract } from "@/server/features/ai/skills/contracts/skill-contract";
import {
  resolvedSlotsSchema,
  slotValueSchema,
  type ResolvedSlots,
} from "@/server/features/ai/skills/contracts/slot-types";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { buildSlotClarificationPrompt } from "@/server/features/ai/skills/slots/slot-clarifications";
import { normalizeSemanticEntities } from "@/server/features/ai/skills/slots/normalize-entities";

export interface SlotResolutionResult {
  resolved: ResolvedSlots;
  missingRequired: string[];
  ambiguous: string[];
  clarificationPrompt?: string;
}

function extractEmails(text: string): string[] {
  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return Array.from(new Set(emails.map((e) => e.toLowerCase())));
}

function extractIsoDateTime(text: string): string | undefined {
  const iso = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})/);
  return iso?.[0];
}

function extractIsoDateTimes(text: string): string[] {
  return text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})/g) ?? [];
}

function extractUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s)]+/i);
  return m?.[0];
}

function parseWorkDays(text: string): number[] | undefined {
  const lower = text.toLowerCase();
  if (/\bweekdays\b/.test(lower) || /\bmon(?:day)?\s*-\s*fri(?:day)?\b/.test(lower)) return [1, 2, 3, 4, 5];
  if (/\bweekends\b/.test(lower) || /\bsat(?:urday)?\s*-\s*sun(?:day)?\b/.test(lower)) return [0, 6];
  const days: Array<[RegExp, number]> = [
    [/\bsun(?:day)?\b/, 0],
    [/\bmon(?:day)?\b/, 1],
    [/\btue(?:sday)?\b/, 2],
    [/\bwed(?:nesday)?\b/, 3],
    [/\bthu(?:rsday)?\b/, 4],
    [/\bfri(?:day)?\b/, 5],
    [/\bsat(?:urday)?\b/, 6],
  ];
  const out = days.filter(([re]) => re.test(lower)).map(([, n]) => n);
  return out.length ? Array.from(new Set(out)) : undefined;
}

function parseWorkHours(text: string): { start?: number; end?: number } | undefined {
  const lower = text.toLowerCase();
  const m = lower.match(/(\d{1,2})(?::\d{2})?\s*(am|pm)?\s*(?:to|-|–)\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?/i);
  if (!m) return undefined;
  const a = Number.parseInt(m[1]!, 10);
  const b = Number.parseInt(m[3]!, 10);
  const ampmA = m[2];
  const ampmB = m[4];
  const to24 = (h: number, ampm?: string) => {
    if (!ampm) return h;
    const isPm = ampm.toLowerCase() === "pm";
    if (isPm && h < 12) return h + 12;
    if (!isPm && h === 12) return 0;
    return h;
  };
  const start = to24(a, ampmA);
  const end = to24(b, ampmB);
  if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start <= 23 && end >= 0 && end <= 23) {
    return { start, end };
  }
  return undefined;
}

function resolveSlotValue(slot: string, message: string): unknown {
  const lower = message.toLowerCase();
  const isoList = extractIsoDateTimes(message);

  if (slot.includes("time_window") || slot.includes("date_window") || slot.includes("window") || slot === "analysis_window") {
    if (isoList.length >= 2) return { start: isoList[0], end: isoList[1] };
    if (isoList.length === 1) return { start: isoList[0] };
    if (/today/i.test(lower)) return "today";
    if (/this week/i.test(lower)) return "this_week";
  }

  if (slot.includes("send_time") || slot.includes("defer_until") || slot === "start") {
    const iso = extractIsoDateTime(message);
    if (iso) return iso;
  }

  if (slot.includes("participants") || slot.includes("recipient")) {
    const emails = extractEmails(message);
    if (emails.length > 0) {
      if (slot.includes("participants")) return { emails };
      return emails;
    }
  }

  if (slot === "booking_link") {
    const url = extractUrl(message);
    if (url) return url;
  }

  if (slot === "workDays") {
    const days = parseWorkDays(message);
    if (days) return days;
  }

  if (slot === "workHourStart" || slot === "workHourEnd") {
    const hours = parseWorkHours(message);
    if (hours?.start != null && slot === "workHourStart") return hours.start;
    if (hours?.end != null && slot === "workHourEnd") return hours.end;
  }

  if (slot === "body") {
    const quoted = message.match(/["“]([\s\S]{10,})["”]/);
    if (quoted?.[1]) return quoted[1].trim();
    const afterSay = message.match(/(?:say|saying|body:|that says)\s*[:\-]?\s*([\s\S]{10,})/i);
    if (afterSay?.[1]) return afterSay[1].trim();
  }

  if (slot === "duration") {
    const m = lower.match(/(\d+)\s*(min|minute|minutes|hour|hours)/i);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (/hour/i.test(m[2])) return n * 60;
      return n;
    }
  }

  if (slot === "thread_id") {
    const m = message.match(/thread[_\s-]?id[:\s]+([a-zA-Z0-9_-]+)/i);
    if (m?.[1]) return m[1];
  }
  if (slot === "thread_ids") {
    const explicit = [...message.matchAll(/thread[_\s-]?id[:\s]+([a-zA-Z0-9_-]+)/gi)].map((m) => m[1]).filter(Boolean);
    if (explicit.length > 0) return explicit;
  }

  if (slot === "event_id") {
    const m = message.match(/event[_\s-]?id[:\s]+([a-zA-Z0-9_-]+)/i);
    if (m?.[1]) return m[1];
  }
  if (slot === "calendar_id") {
    const m = message.match(/calendar[_\s-]?id[:\s]+([a-zA-Z0-9_.@-]+)/i);
    if (m?.[1]) return m[1];
  }

  if (slot === "draft_id") {
    const m = message.match(/draft[_\s-]?id[:\s]+([a-zA-Z0-9_-]+)/i);
    if (m?.[1]) return m[1];
  }
  if (slot === "filter_id") {
    const m = message.match(/filter[_\s-]?id[:\s]+([a-zA-Z0-9_-]+)/i);
    if (m?.[1]) return m[1];
  }
  if (slot === "label_id") {
    const m = message.match(/label[_\s-]?id[:\s]+([a-zA-Z0-9_-]+)/i);
    if (m?.[1]) return m[1];
  }
  if (slot === "label_ids") {
    const ids = [...message.matchAll(/label[_\s-]?id[:\s]+([a-zA-Z0-9_-]+)/gi)]
      .map((m) => m[1])
      .filter(Boolean);
    if (ids.length > 0) return ids;
  }
  if (slot === "folder_name") {
    const m = message.match(/(?:to|into)\s+folder\s+['"]?([^'"\n]+)['"]?/i);
    if (m?.[1]) return m[1].trim();
  }
  if (slot === "mode") {
    if (/\bwhole series\b|\bentire series\b|\bseries\b/i.test(lower)) return "series";
    if (/\bthis instance\b|\bjust this one\b|\bsingle\b/i.test(lower)) return "single";
  }
  if (slot === "working_location") {
    if (/\bremote\b|\bhome\b/i.test(lower)) return "remote";
    if (/\boffice\b|\bon-site\b|\bonsite\b/i.test(lower)) return "office";
    const m = message.match(/working location[:\s]+([^\n.]+)/i);
    if (m?.[1]) return m[1].trim();
  }
  if (slot === "attendee_email") {
    const email = extractEmails(message)[0];
    if (email) return email;
  }
  if (slot === "read") {
    if (/\bunread\b/i.test(lower)) return false;
    if (/\bread\b/i.test(lower)) return true;
  }
  if (slot === "label_action") {
    if (/\bremove\b/i.test(lower)) return "remove";
    if (/\badd\b|\bapply\b/i.test(lower)) return "apply";
  }
  if (slot === "action_type") {
    if (/\bspam\b|\bjunk\b/i.test(lower)) return "spam";
    if (/\bmove\b/i.test(lower)) return "move";
  }
  if (slot === "filter_action") {
    if (/\bdelete\b|\bremove\b/i.test(lower)) return "delete";
    if (/\bcreate\b|\badd\b/i.test(lower)) return "create";
    if (/\blist\b|\bshow\b/i.test(lower)) return "list";
  }
  if (slot === "send_mode") {
    if (/\bforward\b/i.test(lower)) return "forward";
    if (/\breply\b/i.test(lower)) return "reply";
    if (/\bsend\b/i.test(lower)) return "send_now";
  }
  if (slot === "composite_actions") {
    if (/\band\b|\balso\b|\bthen\b|\bplus\b/i.test(lower)) {
      const parts = message
        .split(/\band\b|\balso\b|\bthen\b|\bplus\b/gi)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (parts.length > 1) return parts;
    }
  }

  if (slot === "reply_intent") {
    if (/reply|respond|draft|compose|write/i.test(lower)) return message.trim();
  }

  if (slot === "title") {
    const quoted = message.match(/["“]([^"”]{4,120})["”]/);
    if (quoted?.[1]) return quoted[1].trim();
    const about = message.match(/(?:meeting|event|call)\s+(?:about|for)\s+(.{3,80})/i);
    if (about?.[1]) return about[1].trim();
  }

  if (slot === "subject") {
    const m = message.match(/subject[:\s]+(.{3,120})/i);
    if (m?.[1]) return m[1].trim();
  }

  if (slot === "planning_day") {
    if (/today/i.test(lower)) return "today";
    if (/tomorrow/i.test(lower)) return "tomorrow";
  }

  if (slot === "target_scope") {
    if (/today/i.test(lower)) return "today";
    if (/week/i.test(lower)) return "this_week";
    if (/month/i.test(lower)) return "this_month";
  }

  if (slot === "sender_or_domain") {
    const email = extractEmails(message)[0];
    if (email) return email;
    const domainMatch = message.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (domainMatch?.[0]) return domainMatch[0];
  }

  if (slot === "policy_type") {
    if (/working hours?/i.test(lower)) return "working_hours";
    if (/out of office|ooo/i.test(lower)) return "out_of_office";
  }

  return undefined;
}

const llmSlotSchema = z.object({
  slots: z.record(z.string(), slotValueSchema),
}).strict();

function applySkillDefaults(skill: SkillContract, resolved: ResolvedSlots): ResolvedSlots {
  const out: ResolvedSlots = { ...resolved };

  const ensureWindow = (slot: string, value: "today" | "this_week") => {
    if (out[slot] === undefined) out[slot] = value as never;
  };

  if (skill.id === "inbox_triage_today" && out.time_window === undefined) {
    out.time_window = "today" as never;
  }
  if (skill.id === "inbox_followup_guard" && out.time_window === undefined) {
    out.time_window = "this_week" as never;
  }
  if (skill.id === "daily_plan_inbox_calendar" && out.date_window === undefined) {
    out.date_window = "today" as never;
  }
  if (skill.id === "inbox_bulk_newsletter_cleanup" && out.target_scope === undefined) {
    out.target_scope = "this_week" as never;
  }
  if (skill.id === "calendar_find_availability") {
    ensureWindow("date_window", "this_week");
    if (out.duration === undefined) out.duration = 30 as never;
  }
  if (skill.id === "calendar_meeting_load_rebalance") {
    ensureWindow("analysis_window", "this_week");
  }
  if (skill.id === "calendar_reschedule_with_constraints") {
    ensureWindow("reschedule_window", "this_week");
  }
  if (skill.id === "calendar_schedule_from_context") {
    if (out.duration === undefined) out.duration = 30 as never;
  }
  if (skill.id === "calendar_working_hours_ooo") {
    if (out.policy_type === undefined) {
      if (out.workHourStart !== undefined || out.workHourEnd !== undefined || out.workDays !== undefined) {
        out.policy_type = "working_hours" as never;
      } else if (out.ooo_window !== undefined) {
        out.policy_type = "out_of_office" as never;
      }
    }
  }

  return out;
}

function normalizeSlotShorthands(resolved: ResolvedSlots, timeZone: string): ResolvedSlots {
  const out: ResolvedSlots = { ...resolved };
  for (const slot of Object.keys(out)) {
    const value = out[slot];
    if ((slot.includes("time_window") || slot.includes("date_window") || slot.includes("window")) && typeof value === "string") {
      const now = new Date();
      if (value === "today") {
        out[slot] = { start: now.toISOString(), timezone: timeZone } as never;
      }
      if (value === "this_week") {
        out[slot] = {
          start: now.toISOString(),
          end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          timezone: timeZone,
        } as never;
      }
    }
  }
  return out;
}

function referencesEmailContext(message: string): boolean {
  return /\b(this|that|last)\s+(email|thread|message|one)\b/i.test(message);
}

function referencesEventContext(message: string): boolean {
  return /\b(this|that|last)\s+(meeting|event|one)\b/i.test(message);
}

function bindContextualReferences(params: {
  skill: SkillContract;
  message: string;
  sourceEmailThreadId?: string;
  sourceEmailMessageId?: string;
  sourceCalendarEventId?: string;
  resolved: ResolvedSlots;
}): ResolvedSlots {
  const out: ResolvedSlots = { ...params.resolved };
  const allSlots = new Set<string>([
    ...params.skill.required_slots,
    ...params.skill.optional_slots,
  ]);

  const needsThreadId = allSlots.has("thread_id") || allSlots.has("thread_ids");
  const needsMessageId = allSlots.has("message_id");
  const needsEventId = allSlots.has("event_id");

  const emailRef = referencesEmailContext(params.message);
  if (emailRef || /\blast one\b/i.test(params.message)) {
    if (needsThreadId && params.sourceEmailThreadId) {
      if (out.thread_id === undefined) out.thread_id = params.sourceEmailThreadId as never;
      if (out.thread_ids === undefined) out.thread_ids = [params.sourceEmailThreadId] as never;
    }
    if (needsMessageId && params.sourceEmailMessageId && out.message_id === undefined) {
      out.message_id = params.sourceEmailMessageId as never;
    }
  }

  const eventRef = referencesEventContext(params.message);
  if ((eventRef || /\blast one\b/i.test(params.message)) && needsEventId) {
    if (params.sourceCalendarEventId && out.event_id === undefined) {
      out.event_id = params.sourceCalendarEventId as never;
    }
  }

  return out;
}

async function resolveMissingSlotsWithLLM(params: {
  logger: Logger;
  emailAccount: { id: string; email: string; userId: string };
  skill: SkillContract;
  message: string;
  timeZone: string;
  missing: string[];
}): Promise<ResolvedSlots> {
  const modelOptions = getModel();
  const generateObject = createGenerateObject({
    emailAccount: params.emailAccount,
    label: `Skills slot extraction (${params.skill.id})`,
    modelOptions,
  });

  const { object } = await generateObject({
    ...modelOptions,
    schema: llmSlotSchema,
    prompt: `Extract ONLY the requested slots for the given skill.

Constraints:
- Output MUST be JSON.
- Only include keys for the requested slots.
- Allowed slot value shapes:
  - string
  - number (duration minutes)
  - boolean
  - array of strings (e.g. email addresses)
  - time range object: {"start": ISO8601, "end"?: ISO8601, "timezone"?: IANA}
  - participants object: {"emails":[...]}

User timezone: ${params.timeZone}
Skill: ${params.skill.id}
Requested slots: ${params.missing.join(", ")}

User message:
${params.message.trim()}
`,
  });

  const filtered: ResolvedSlots = {};
  for (const key of params.missing) {
    const value = object.slots[key];
    if (value !== undefined) {
      filtered[key] = value as never;
    }
  }
  return filtered;
}

export async function resolveSlots(
  skill: SkillContract,
  message: string,
  env: {
    logger: Logger;
    emailAccount: { id: string; email: string; userId: string };
    timeZone: string;
    sourceEmailThreadId?: string;
    sourceEmailMessageId?: string;
    sourceCalendarEventId?: string;
    seedResolvedSlots?: ResolvedSlots;
  },
): Promise<SlotResolutionResult> {
  const seeded = env.seedResolvedSlots
    ? resolvedSlotsSchema.safeParse(env.seedResolvedSlots)
    : null;
  const resolved: ResolvedSlots =
    seeded && seeded.success ? { ...seeded.data } : {};
  for (const slot of [...skill.required_slots, ...skill.optional_slots]) {
    const value = resolveSlotValue(slot, message);
    if (value !== undefined) {
      resolved[slot] = value as never;
    }
  }

  // Thread/message defaults: when the user says "this" on a surface, we can bind to the source thread.
  if (resolved.thread_ids === undefined && env.sourceEmailThreadId) {
    resolved.thread_ids = [env.sourceEmailThreadId] as never;
  }
  if (resolved.thread_id === undefined && env.sourceEmailThreadId) {
    resolved.thread_id = env.sourceEmailThreadId as never;
  }
  if (resolved.message_id === undefined && env.sourceEmailMessageId) {
    resolved.message_id = env.sourceEmailMessageId as never;
  }

  const contextBound = bindContextualReferences({
    skill,
    message,
    sourceEmailThreadId: env.sourceEmailThreadId,
    sourceEmailMessageId: env.sourceEmailMessageId,
    sourceCalendarEventId: env.sourceCalendarEventId,
    resolved,
  });

  const semanticNormalization = normalizeSemanticEntities({
    rawMessage: message,
    entities: Object.entries(contextBound).map(([key, value]) => ({ key, value })),
    timeZone: env.timeZone,
  });
  for (const slot of [...skill.required_slots, ...skill.optional_slots]) {
    if (contextBound[slot] === undefined && semanticNormalization.normalized[slot] !== undefined) {
      contextBound[slot] = semanticNormalization.normalized[slot] as never;
    }
  }

  const normalized = normalizeSlotShorthands(applySkillDefaults(skill, contextBound), env.timeZone);

  // Validate extracted shapes; drop invalid.
  const validated = resolvedSlotsSchema.safeParse(normalized);
  const safeResolved: ResolvedSlots = validated.success ? validated.data : {};

  let missingRequired = skill.required_slots.filter((slot) => safeResolved[slot] === undefined);

  if (missingRequired.length > 0) {
    try {
      const llmSlots = await resolveMissingSlotsWithLLM({
        logger: env.logger,
        emailAccount: env.emailAccount,
        skill,
        message,
        timeZone: env.timeZone,
        missing: missingRequired,
      });
      const merged = normalizeSlotShorthands(
        applySkillDefaults(skill, { ...safeResolved, ...llmSlots } as ResolvedSlots),
        env.timeZone,
      );
      const mergedValidated = resolvedSlotsSchema.safeParse(merged);
      if (mergedValidated.success) {
        missingRequired = skill.required_slots.filter((slot) => mergedValidated.data[slot] === undefined);
        return {
          resolved: mergedValidated.data,
          missingRequired,
          ambiguous: semanticNormalization.unresolved,
          clarificationPrompt: buildSlotClarificationPrompt(missingRequired),
        };
      }
    } catch (error) {
      env.logger.warn("[skills-slots] LLM slot extraction failed", { error });
    }
  }

  return {
    resolved: safeResolved,
    missingRequired,
    ambiguous: semanticNormalization.unresolved,
    clarificationPrompt: buildSlotClarificationPrompt(missingRequired),
  };
}
