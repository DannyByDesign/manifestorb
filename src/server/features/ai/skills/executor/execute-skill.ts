import type { SkillContract, CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import type { SlotResolutionResult } from "@/server/features/ai/skills/slots/resolve-slots";
import type { SkillCapabilities } from "@/server/features/ai/capabilities";
import type { ToolResult } from "@/server/features/ai/tools/types";

export interface SkillExecutionResult {
  status: "success" | "partial" | "blocked" | "failed";
  responseText: string;
  postconditionsPassed: boolean;
  stepsExecuted: number;
  toolChain: CapabilityName[];
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

export async function executeSkill(params: {
  skill: SkillContract;
  slots: SlotResolutionResult;
  capabilities: SkillCapabilities;
}): Promise<SkillExecutionResult> {
  const { skill, slots, capabilities } = params;

  if (slots.missingRequired.length > 0) {
    return {
      status: "blocked",
      responseText: slots.clarificationPrompt ?? renderTemplate(skill, "blocked"),
      postconditionsPassed: false,
      stepsExecuted: 0,
      toolChain: [],
      interactivePayloads: [],
      failureReason: "missing_required_slots",
    };
  }

  const toolChain: CapabilityName[] = [];
  let stepsExecuted = 0;
  const toolResults: Record<string, ToolResult> = {};
  const interactivePayloads: unknown[] = [];
  let lastQueriedEmailIds: string[] = [];

  try {
    for (const step of skill.plan) {
      stepsExecuted += 1;
      if (!step.capability) continue;
      enforceAllowed(skill, step.capability);
      toolChain.push(step.capability);

      // Deterministic baseline executor: map slot values into narrow capability calls.
      switch (step.capability) {
        case "email.searchThreads": {
          const window = getDateRangeFromSlot(slots.resolved.time_window);
          const scope = typeof slots.resolved.target_scope === "string" ? slots.resolved.target_scope : null;
          const scopeWindow =
            scope === "today"
              ? { after: new Date().toISOString() }
              : scope === "this_week"
                ? { after: new Date().toISOString(), before: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() }
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
          }
          toolResults[step.id] = await capabilities.email.searchThreads(filter);
          lastQueriedEmailIds = extractQueryMessageIds(toolResults[step.id]);
          break;
        }
        case "email.batchArchive": {
          const ids = Array.isArray(slots.resolved.thread_ids)
            ? (slots.resolved.thread_ids as string[])
            : lastQueriedEmailIds;
          toolResults[step.id] = await capabilities.email.batchArchive(ids);
          break;
        }
        case "email.unsubscribeSender": {
          const sender = slots.resolved.sender_or_domain;
          toolResults[step.id] = await capabilities.email.unsubscribeSender({
            filter: sender ? { from: String(sender), subscriptionsOnly: true, limit: 25 } : undefined,
          });
          break;
        }
        case "email.snoozeThread": {
          const ids = Array.isArray(slots.resolved.thread_ids)
            ? (slots.resolved.thread_ids as string[])
            : lastQueriedEmailIds;
          const until = typeof slots.resolved.defer_until === "string" ? slots.resolved.defer_until : "";
          toolResults[step.id] = await capabilities.email.snoozeThread(ids, until);
          break;
        }
        case "email.createDraft": {
          const recipient = Array.isArray(slots.resolved.recipient)
            ? (slots.resolved.recipient as string[])
            : [];
          const body = typeof slots.resolved.body === "string" ? slots.resolved.body : "Draft reply.";
          const subject = typeof slots.resolved.subject === "string" ? slots.resolved.subject : undefined;
          toolResults[step.id] = await capabilities.email.createDraft({ to: recipient, subject, body });
          break;
        }
        case "calendar.findAvailability": {
          const durationMinutes = typeof slots.resolved.duration === "number" ? slots.resolved.duration : 30;
          const window = getAvailabilityWindowFromSlot(slots.resolved.date_window);
          toolResults[step.id] = await capabilities.calendar.findAvailability({
            durationMinutes,
            ...(window?.start ? { start: window.start } : {}),
            ...(window?.end ? { end: window.end } : {}),
          });
          break;
        }
        case "calendar.createEvent": {
          const title = typeof slots.resolved.title === "string" ? slots.resolved.title : "New event";
          const start = typeof slots.resolved.start === "string" ? slots.resolved.start : undefined;
          const end = typeof slots.resolved.end === "string" ? slots.resolved.end : undefined;
          toolResults[step.id] = await capabilities.calendar.createEvent({
            title,
            ...(start ? { start } : {}),
            ...(end ? { end } : {}),
          });
          break;
        }
        case "calendar.rescheduleEvent": {
          const eventId = String(slots.resolved.event_id ?? "");
          toolResults[step.id] = await capabilities.calendar.rescheduleEvent([eventId], { reschedule: "next_available" });
          break;
        }
        case "planner.composeDayPlan": {
          toolResults[step.id] = await capabilities.planner.composeDayPlan({ topEmailItems: [], calendarItems: [] });
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
            interactivePayloads,
            failureReason: result.error ?? "tool_clarification",
          };
        }
        throw new Error(result.error ?? `tool_failed:${step.capability}`);
      }
    }

    // Minimal postcondition validator: if all tool steps succeeded, consider postconditions passed.
    const lastStepId = skill.plan.at(-1)?.id ?? "";
    const lastMessage = lastStepId ? toolResults[lastStepId]?.message : undefined;
    return {
      status: "success",
      responseText: lastMessage ?? renderTemplate(skill, "success"),
      postconditionsPassed: true,
      stepsExecuted,
      toolChain,
      interactivePayloads,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isPolicyViolation = message.startsWith("allowed_tools_violation");
    const isNotImplemented = message.startsWith("capability_not_implemented");

    return {
      status: "failed",
      responseText: isPolicyViolation
        ? "I couldn't safely complete that request."
        : isNotImplemented
          ? "That action isn't available yet."
          : renderTemplate(skill, "failed"),
      postconditionsPassed: false,
      stepsExecuted,
      toolChain,
      interactivePayloads,
      failureReason: message,
    };
  }
}
