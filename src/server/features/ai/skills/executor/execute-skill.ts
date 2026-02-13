import type { SkillContract, CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import type { SlotResolutionResult } from "@/server/features/ai/skills/slots/resolve-slots";
import type { SkillCapabilities } from "@/server/features/ai/capabilities";
import type { ToolResult } from "@/server/features/ai/tools/types";
import { validateSkillPostconditions } from "@/server/features/ai/skills/executor/postconditions";
import { normalizeSkillFailure } from "@/server/features/ai/skills/executor/failure-normalizer";
import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type { Logger } from "@/server/lib/logger";

export interface SkillExecutionResult {
  status: "success" | "partial" | "blocked" | "failed";
  responseText: string;
  postconditionsPassed: boolean;
  stepsExecuted: number;
  toolChain: CapabilityName[];
  stepDurationsMs: Record<string, number>;
  interactivePayloads: unknown[];
  failureReason?: string;
}

function enforceAllowed(skill: SkillContract, capability: CapabilityName): void {
  if (!skill.allowed_tools.includes(capability)) {
    throw new Error(`allowed_tools_violation: ${capability} not allowed for ${skill.id}`);
  }
}

function renderTemplate(skill: SkillContract, status: SkillExecutionResult["status"]): string {
  const t = skill.user_response_templates;
  if (status === "success") return t.success;
  if (status === "partial") return t.partial;
  if (status === "blocked") return t.blocked;
  return t.failed;
}

function isFailure(result: ToolResult): boolean {
  return result.success !== true;
}

function toolClarificationPrompt(result: ToolResult): string | null {
  return result.clarification?.prompt ?? null;
}

function getDateRangeFromSlot(value: unknown): { after?: string; before?: string } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const start = typeof v.start === "string" ? v.start : undefined;
  const end = typeof v.end === "string" ? v.end : undefined;
  if (!start && !end) return null;
  return { after: start, ...(end ? { before: end } : {}) };
}

function dayRange(offsetDays: number): { after: string; before: string } {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + offsetDays);
  const end = new Date(base);
  end.setDate(end.getDate() + 1);
  return { after: base.toISOString(), before: end.toISOString() };
}

function weekRange(): { after: string; before: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { after: start.toISOString(), before: end.toISOString() };
}

function getAvailabilityWindowFromSlot(value: unknown): { start?: string; end?: string } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const start = typeof v.start === "string" ? v.start : undefined;
  const end = typeof v.end === "string" ? v.end : undefined;
  if (!start && !end) return null;
  return { start, end };
}

function extractQueryMessageIds(result: ToolResult | undefined): string[] {
  const data = result?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>).id : null))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

const summarizeThreadSchema = z.object({
  decisions: z.array(z.string()).default([]),
  actionItems: z.array(z.string()).default([]),
  deadlines: z.array(z.string()).default([]),
}).strict();

async function summarizeThreadWithLLM(params: {
  logger: Logger;
  emailAccount: { id: string; email: string; userId: string };
  messages: Array<{ subject?: string | null; snippet?: string | null; textPlain?: string | null; headers?: Record<string, unknown> | null }>;
}): Promise<z.infer<typeof summarizeThreadSchema>> {
  const modelOptions = getModel();
  const generateObject = createGenerateObject({
    emailAccount: params.emailAccount,
    label: "Skills thread summary",
    modelOptions,
  });

  const compact = params.messages.slice(-12).map((m) => ({
    subject: m.subject ?? null,
    snippet: m.snippet ?? (m.textPlain ? String(m.textPlain).slice(0, 200) : null),
    from: (m.headers as any)?.from ?? null,
    to: (m.headers as any)?.to ?? null,
  }));

  const { object } = await generateObject({
    ...modelOptions,
    schema: summarizeThreadSchema,
    prompt: `Summarize the email thread into:
- decisions (finalized choices)
- actionItems (who should do what)
- deadlines (explicit dates/times or time constraints)

Rules:
- Be concise.
- Do not invent facts.
- If unknown, leave arrays empty.

Thread messages (most recent last):
${JSON.stringify(compact)}
`,
  });

  return object;
}

export async function executeSkill(params: {
  skill: SkillContract;
  slots: SlotResolutionResult;
  capabilities: SkillCapabilities;
  runtime: {
    logger: Logger;
    emailAccount: { id: string; email: string; userId: string };
  };
}): Promise<SkillExecutionResult> {
  const { skill, slots, capabilities, runtime } = params;

  if (slots.missingRequired.length > 0) {
    return {
      status: "blocked",
      responseText: slots.clarificationPrompt ?? renderTemplate(skill, "blocked"),
      postconditionsPassed: false,
      stepsExecuted: 0,
      toolChain: [],
      stepDurationsMs: {},
      interactivePayloads: [],
      failureReason: "missing_required_slots",
    };
  }

  const toolChain: CapabilityName[] = [];
  const stepDurationsMs: Record<string, number> = {};
  let stepsExecuted = 0;
  const toolResults: Record<string, ToolResult> = {};
  const interactivePayloads: unknown[] = [];
  let lastQueriedEmailIds: string[] = [];
  let lastQueriedEmailItems: unknown[] = [];
  let lastQueriedCalendarItems: unknown[] = [];

  try {
    for (const step of skill.plan) {
      stepsExecuted += 1;
      if (!step.capability) continue;

      // Skill-specific conditional execution.
      if (skill.id === "calendar_working_hours_ooo") {
        const policy = String(slots.resolved.policy_type ?? "");
        if (policy === "working_hours" && step.capability === "calendar.setOutOfOffice") continue;
        if (policy === "out_of_office" && step.capability === "calendar.setWorkingHours") continue;
      }
      enforceAllowed(skill, step.capability);
      toolChain.push(step.capability);

      // Deterministic baseline executor: map slot values into narrow capability calls.
      switch (step.capability) {
        case "email.searchThreads": {
          const window = getDateRangeFromSlot(
            slots.resolved.time_window ?? slots.resolved.date_window ?? slots.resolved.analysis_window,
          );
          const scope = typeof slots.resolved.target_scope === "string" ? slots.resolved.target_scope : null;
          const scopeWindow =
            scope === "today"
              ? dayRange(0)
              : scope === "this_week"
                ? weekRange()
                : null;
          const filter: Record<string, unknown> = {
            limit: 25,
            ...(window ? { dateRange: window } : {}),
            ...(!window && scopeWindow ? { dateRange: scopeWindow } : {}),
            ...(typeof slots.resolved.sender_or_domain === "string" ? { from: slots.resolved.sender_or_domain } : {}),
          };
          if (skill.id === "inbox_bulk_newsletter_cleanup" || skill.id === "inbox_subscription_control") {
            filter.subscriptionsOnly = true;
            filter.limit = 100;
            filter.fetchAll = true;
          }
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.email.searchThreads(filter);
          stepDurationsMs[step.id] = Date.now() - startedAt;
          lastQueriedEmailIds = extractQueryMessageIds(toolResults[step.id]);
          lastQueriedEmailItems = Array.isArray(toolResults[step.id]?.data) ? (toolResults[step.id]!.data as unknown[]) : [];
          break;
        }
        case "email.getThreadMessages": {
          const threadId = String(slots.resolved.thread_id ?? "");
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.email.getThreadMessages(threadId);
          stepDurationsMs[step.id] = Date.now() - startedAt;
          break;
        }
        case "email.batchArchive": {
          const ids = Array.isArray(slots.resolved.thread_ids)
            ? (slots.resolved.thread_ids as string[])
            : lastQueriedEmailIds;
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.email.batchArchive(ids);
          stepDurationsMs[step.id] = Date.now() - startedAt;
          break;
        }
        case "email.unsubscribeSender": {
          const sender = slots.resolved.sender_or_domain;
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.email.unsubscribeSender({
            filter: sender ? { from: String(sender), subscriptionsOnly: true, limit: 25 } : undefined,
          });
          stepDurationsMs[step.id] = Date.now() - startedAt;
          break;
        }
        case "email.snoozeThread": {
          const ids = Array.isArray(slots.resolved.thread_ids)
            ? (slots.resolved.thread_ids as string[])
            : lastQueriedEmailIds;
          const until = typeof slots.resolved.defer_until === "string" ? slots.resolved.defer_until : "";
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.email.snoozeThread(ids, until);
          stepDurationsMs[step.id] = Date.now() - startedAt;
          break;
        }
        case "email.createDraft": {
          const threadId = typeof slots.resolved.thread_id === "string" ? slots.resolved.thread_id : undefined;
          const recipient = Array.isArray(slots.resolved.recipient)
            ? (slots.resolved.recipient as string[])
            : [];
          const body = typeof slots.resolved.body === "string" ? slots.resolved.body : "Draft reply.";
          const subject = typeof slots.resolved.subject === "string" ? slots.resolved.subject : undefined;
          if (!threadId && recipient.length === 0) {
            return {
              status: "blocked",
              responseText: "Who should this draft be sent to? If this is a reply, share the thread context.",
              postconditionsPassed: false,
              stepsExecuted,
              toolChain,
              stepDurationsMs,
              interactivePayloads,
              failureReason: "missing_recipient_or_thread",
            };
          }
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.email.createDraft({
            ...(threadId ? { type: "reply", parentId: threadId } : {}),
            ...(recipient.length > 0 ? { to: recipient } : {}),
            ...(subject ? { subject } : {}),
            body,
          });
          stepDurationsMs[step.id] = Date.now() - startedAt;
          break;
        }
        case "email.scheduleSend": {
          const draftId = String(slots.resolved.draft_id ?? "");
          const sendTime = typeof slots.resolved.send_time === "string" ? slots.resolved.send_time : "";
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.email.scheduleSend(draftId, sendTime);
          stepDurationsMs[step.id] = Date.now() - startedAt;
          break;
        }
        case "calendar.findAvailability": {
          const durationMinutes = typeof slots.resolved.duration === "number" ? slots.resolved.duration : 30;
          const window = getAvailabilityWindowFromSlot(
            slots.resolved.date_window ??
              slots.resolved.reschedule_window ??
              slots.resolved.analysis_window ??
              slots.resolved.focus_block_window,
          );
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.calendar.findAvailability({
            durationMinutes,
            ...(window?.start ? { start: window.start } : {}),
            ...(window?.end ? { end: window.end } : {}),
          });
          stepDurationsMs[step.id] = Date.now() - startedAt;
          lastQueriedCalendarItems = (toolResults[step.id]?.data as any)?.slots ? ((toolResults[step.id]?.data as any).slots as unknown[]) : [];
          break;
        }
        case "calendar.listEvents": {
          const range = getDateRangeFromSlot(
            slots.resolved.date_window ?? slots.resolved.analysis_window ?? slots.resolved.time_window,
          );
          const filter: Record<string, unknown> = {
            limit: 50,
            ...(range ? { dateRange: range } : {}),
          };
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.calendar.listEvents(filter);
          stepDurationsMs[step.id] = Date.now() - startedAt;
          lastQueriedCalendarItems = Array.isArray(toolResults[step.id]?.data) ? (toolResults[step.id]!.data as unknown[]) : [];
          break;
        }
        case "calendar.createEvent": {
          const title = typeof slots.resolved.title === "string" ? slots.resolved.title : "New event";
          const start = typeof slots.resolved.start === "string" ? slots.resolved.start : undefined;
          const durationMinutes = typeof slots.resolved.duration === "number" ? slots.resolved.duration : undefined;
          const end =
            typeof slots.resolved.end === "string"
              ? slots.resolved.end
              : start && durationMinutes
                ? new Date(new Date(start).getTime() + durationMinutes * 60 * 1000).toISOString()
                : undefined;
          const participants = Array.isArray((slots.resolved.participants as any)?.emails)
            ? ((slots.resolved.participants as any).emails as string[])
            : Array.isArray(slots.resolved.recipient)
              ? (slots.resolved.recipient as string[])
              : [];
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.calendar.createEvent({
            title,
            ...(start ? { start } : {}),
            ...(end ? { end } : {}),
            ...(participants.length > 0 ? { attendees: participants } : {}),
            ...(typeof slots.resolved.location === "string" ? { location: slots.resolved.location } : {}),
            ...(typeof slots.resolved.agenda === "string" ? { description: slots.resolved.agenda } : {}),
          });
          stepDurationsMs[step.id] = Date.now() - startedAt;
          break;
        }
        case "calendar.rescheduleEvent": {
          const eventId = String(slots.resolved.event_id ?? "");
          const window = getAvailabilityWindowFromSlot(slots.resolved.reschedule_window);
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.calendar.rescheduleEvent([eventId], {
            reschedule: "next_available",
            ...(window?.start ? { after: window.start } : {}),
            ...(window?.end ? { before: window.end } : {}),
          });
          stepDurationsMs[step.id] = Date.now() - startedAt;
          break;
        }
        case "calendar.setWorkingHours": {
          const changes: Record<string, unknown> = {};
          if (typeof slots.resolved.timezone === "string") changes.timeZone = slots.resolved.timezone;
          if (typeof slots.resolved.workHourStart === "number") changes.workHourStart = slots.resolved.workHourStart;
          if (typeof slots.resolved.workHourEnd === "number") changes.workHourEnd = slots.resolved.workHourEnd;
          if (Array.isArray(slots.resolved.workDays)) changes.workDays = slots.resolved.workDays;
          if (skill.id === "calendar_working_hours_ooo" && (changes.workHourStart === undefined || changes.workHourEnd === undefined)) {
            return {
              status: "blocked",
              responseText: "What working hours should I set (e.g. 9am-5pm weekdays)?",
              postconditionsPassed: false,
              stepsExecuted,
              toolChain,
              stepDurationsMs,
              interactivePayloads,
              failureReason: "missing_working_hours",
            };
          }
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.calendar.setWorkingHours(changes);
          stepDurationsMs[step.id] = Date.now() - startedAt;
          break;
        }
        case "calendar.setOutOfOffice": {
          const window = getAvailabilityWindowFromSlot(slots.resolved.ooo_window);
          if (skill.id === "calendar_working_hours_ooo" && (!window?.start || !window?.end)) {
            return {
              status: "blocked",
              responseText: "What is your out-of-office window (start and end, ISO-8601)?",
              postconditionsPassed: false,
              stepsExecuted,
              toolChain,
              stepDurationsMs,
              interactivePayloads,
              failureReason: "missing_ooo_window",
            };
          }
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.calendar.setOutOfOffice({
            title: "Out of office",
            ...(window?.start ? { start: window.start } : {}),
            ...(window?.end ? { end: window.end } : {}),
            ...(typeof slots.resolved.location === "string" ? { location: slots.resolved.location } : {}),
          });
          stepDurationsMs[step.id] = Date.now() - startedAt;
          break;
        }
        case "calendar.createFocusBlock": {
          const window = getAvailabilityWindowFromSlot(slots.resolved.focus_block_window);
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.calendar.createFocusBlock({
            title: "Focus time",
            ...(window?.start ? { start: window.start } : {}),
            ...(window?.end ? { end: window.end } : {}),
          });
          stepDurationsMs[step.id] = Date.now() - startedAt;
          break;
        }
        case "calendar.createBookingSchedule": {
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.calendar.createBookingSchedule({
            bookingLink: typeof slots.resolved.booking_link === "string" ? slots.resolved.booking_link : undefined,
          });
          stepDurationsMs[step.id] = Date.now() - startedAt;
          break;
        }
        case "planner.composeDayPlan": {
          const startedAt = Date.now();
          toolResults[step.id] = await capabilities.planner.composeDayPlan({
            topEmailItems: lastQueriedEmailItems,
            calendarItems: lastQueriedCalendarItems,
          });
          stepDurationsMs[step.id] = Date.now() - startedAt;
          break;
        }
        default: {
          // Capabilities intentionally unimplemented in M0/M1 should fail closed.
          throw new Error(`capability_not_implemented: ${step.capability}`);
        }
      }

      const result = toolResults[step.id];
      if (result?.interactive) {
        interactivePayloads.push(result.interactive);
      }
      if (result && isFailure(result)) {
        const clarification = toolClarificationPrompt(result);
        if (clarification) {
          return {
            status: "blocked",
            responseText: clarification,
              postconditionsPassed: false,
              stepsExecuted,
              toolChain,
              stepDurationsMs,
              interactivePayloads,
              failureReason: result.error ?? "tool_clarification",
            };
        }
        throw new Error(result.error ?? `tool_failed:${step.capability}`);
      }
    }

    const postconditionsPassed = validateSkillPostconditions({ skill, toolResults });
    const lastStepId = skill.plan.at(-1)?.id ?? "";
    const lastMessage = lastStepId ? toolResults[lastStepId]?.message : undefined;

    // Skill-specific response rendering when the last tool result isn't user-facing.
    if (skill.id === "inbox_thread_summarize_actions") {
      const data = toolResults["load_thread"]?.data as any;
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      const summary = await summarizeThreadWithLLM({
        logger: runtime.logger,
        emailAccount: runtime.emailAccount,
        messages,
      });
      const lines: string[] = [];
      if (summary.decisions.length) {
        lines.push("Decisions:");
        for (const d of summary.decisions.slice(0, 8)) lines.push(`- ${d}`);
      }
      if (summary.actionItems.length) {
        lines.push(lines.length ? "" : "");
        lines.push("Action items:");
        for (const a of summary.actionItems.slice(0, 12)) lines.push(`- ${a}`);
      }
      if (summary.deadlines.length) {
        lines.push(lines.length ? "" : "");
        lines.push("Deadlines:");
        for (const dl of summary.deadlines.slice(0, 8)) lines.push(`- ${dl}`);
      }
      const responseText = lines.filter((l) => l !== "").join("\n");
      return {
        status: "success",
        responseText: responseText || "I couldn't find clear decisions, action items, or deadlines in that thread.",
        postconditionsPassed,
        stepsExecuted,
        toolChain,
        stepDurationsMs,
        interactivePayloads,
      };
    }

    return {
      status: "success",
      responseText: lastMessage ?? renderTemplate(skill, "success"),
      postconditionsPassed,
      stepsExecuted,
      toolChain,
      stepDurationsMs,
      interactivePayloads,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = normalizeSkillFailure({ skill, errorMessage: message });

    return {
      status: normalized.status,
      responseText: normalized.userMessage,
      postconditionsPassed: false,
      stepsExecuted,
      toolChain,
      stepDurationsMs,
      interactivePayloads,
      failureReason: normalized.reason,
    };
  }
}
