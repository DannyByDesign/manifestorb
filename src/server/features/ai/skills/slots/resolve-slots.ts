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

function resolveSlotValue(slot: string, message: string): unknown {
  const lower = message.toLowerCase();

  if (slot.includes("time_window") || slot.includes("date_window") || slot === "analysis_window") {
    const iso = extractIsoDateTime(message);
    if (iso) return { start: iso };
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

  if (slot === "event_id") {
    const m = message.match(/event[_\s-]?id[:\s]+([a-zA-Z0-9_-]+)/i);
    if (m?.[1]) return m[1];
  }

  if (slot === "draft_id") {
    const m = message.match(/draft[_\s-]?id[:\s]+([a-zA-Z0-9_-]+)/i);
    if (m?.[1]) return m[1];
  }

  if (slot === "reply_intent") {
    if (/reply|respond|draft|compose|write/i.test(lower)) return "reply";
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

function buildClarificationPrompt(missing: string[]): string | undefined {
  if (missing.length === 0) return undefined;
  const primary = missing[0];
  if (missing.length === 1) {
    if (primary === "participants") return "Who should be included? You can paste one or more emails.";
    if (primary === "duration") return "How long should it be (e.g. 30 min or 1 hour)?";
    if (primary.includes("time_window") || primary.includes("date_window")) {
      return "What time window should I use (today, this week, or a specific range)?";
    }
    return `I need one detail to continue: ${primary}.`;
  }
  return `I need a few details to continue: ${missing.join(", ")}.`;
}

const llmSlotSchema = z.object({
  slots: z.record(z.string(), slotValueSchema),
}).strict();

function normalizeSlotShorthands(resolved: ResolvedSlots, timeZone: string): ResolvedSlots {
  const out: ResolvedSlots = { ...resolved };
  for (const slot of Object.keys(out)) {
    const value = out[slot];
    if ((slot.includes("time_window") || slot.includes("date_window")) && typeof value === "string") {
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
  },
): Promise<SlotResolutionResult> {
  const resolved: ResolvedSlots = {};
  for (const slot of [...skill.required_slots, ...skill.optional_slots]) {
    const value = resolveSlotValue(slot, message);
    if (value !== undefined) {
      resolved[slot] = value as never;
    }
  }

  const normalized = normalizeSlotShorthands(resolved, env.timeZone);

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
      const merged = normalizeSlotShorthands({ ...safeResolved, ...llmSlots } as ResolvedSlots, env.timeZone);
      const mergedValidated = resolvedSlotsSchema.safeParse(merged);
      if (mergedValidated.success) {
        missingRequired = skill.required_slots.filter((slot) => mergedValidated.data[slot] === undefined);
        return {
          resolved: mergedValidated.data,
          missingRequired,
          ambiguous: [],
          clarificationPrompt: buildClarificationPrompt(missingRequired),
        };
      }
    } catch (error) {
      env.logger.warn("[skills-slots] LLM slot extraction failed", { error });
    }
  }

  return {
    resolved: safeResolved,
    missingRequired,
    ambiguous: [],
    clarificationPrompt: buildClarificationPrompt(missingRequired),
  };
}
