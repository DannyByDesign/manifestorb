import type { SkillContract } from "@/server/features/ai/skills/contracts/skill-contract";
import type { ToolResult } from "@/server/features/ai/tools/types";

function allStepsSucceeded(toolResults: Record<string, ToolResult>): boolean {
  const results = Object.values(toolResults);
  return results.length > 0 && results.every((result) => result.success === true);
}

function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function countFromResult(result: ToolResult | undefined): number {
  const data =
    result?.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : null;
  const count = data && typeof data.count === "number" ? data.count : 0;
  return count;
}

function hasDataField(result: ToolResult | undefined, field: string): boolean {
  const data =
    result?.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : null;
  const value = data ? data[field] : undefined;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null;
}

export function validateSkillPostconditions(params: {
  skill: SkillContract;
  toolResults: Record<string, ToolResult>;
}): boolean {
  const { skill, toolResults } = params;
  if (!allStepsSucceeded(toolResults)) return false;

  switch (skill.id) {
    case "inbox_triage_today":
    case "inbox_followup_guard":
    case "daily_plan_inbox_calendar": {
      return Boolean(toolResults["compose_plan"]?.success || toolResults["rank"]?.success || toolResults["rank_risk"]?.success);
    }
    case "inbox_bulk_newsletter_cleanup": {
      return countFromResult(toolResults["archive_batch"]) >= 0;
    }
    case "inbox_subscription_control": {
      return countFromResult(toolResults["unsubscribe"]) >= 0;
    }
    case "inbox_snooze_or_defer": {
      return countFromResult(toolResults["snooze"]) >= 0;
    }
    case "inbox_thread_summarize_actions": {
      const data = toolResults["load_thread"]?.data as Record<string, unknown> | undefined;
      return hasNonEmptyArray(data?.messages);
    }
    case "inbox_draft_reply": {
      return hasDataField(toolResults["create_draft"], "draftId");
    }
    case "inbox_schedule_send": {
      return hasDataField(toolResults["schedule_send"], "sendAt");
    }
    case "calendar_find_availability": {
      const data = toolResults["query_availability"]?.data as Record<string, unknown> | undefined;
      return Array.isArray(data?.slots);
    }
    case "calendar_schedule_from_context": {
      return hasDataField(toolResults["create_event"], "id");
    }
    case "calendar_reschedule_with_constraints": {
      return hasDataField(toolResults["reschedule"], "id");
    }
    case "calendar_focus_time_defense": {
      return hasDataField(toolResults["create_focus"], "id");
    }
    case "calendar_working_hours_ooo": {
      const hasWorkingHours = Boolean(toolResults["set_working_hours"]?.success);
      const hasOoo = Boolean(toolResults["set_out_of_office"]?.success);
      return hasWorkingHours || hasOoo;
    }
    case "calendar_booking_page_setup": {
      return hasDataField(toolResults["create_booking_schedule"], "bookingLink");
    }
    case "calendar_meeting_load_rebalance": {
      return Boolean(toolResults["recommend_rebalance"]?.success);
    }
    default:
      return allStepsSucceeded(toolResults);
  }
}
