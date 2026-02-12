import { createBaselineSkill } from "./shared";

export const dailyPlanInboxCalendarSkill = createBaselineSkill({
  id: "daily_plan_inbox_calendar",
  intents: ["plan my day", "daily agenda", "what should I do today"],
  requiredSlots: ["planning_day"],
  optionalSlots: ["priority_focus"],
  allowedTools: ["email.searchThreads", "calendar.findAvailability", "planner.composeDayPlan"],
  risk: "safe",
  plan: [
    { id: "email_priorities", description: "Collect top email priorities", capability: "email.searchThreads", requiredSlots: ["planning_day"] },
    { id: "calendar_overview", description: "Collect calendar schedule", capability: "calendar.findAvailability", requiredSlots: ["planning_day"] },
    { id: "compose_plan", description: "Compose unified daily plan", capability: "planner.composeDayPlan" },
  ],
  successChecks: [{ id: "unified_plan", description: "Unified daily plan returned" }],
  failureModes: [{ code: "INCOMPLETE_CONTEXT", description: "Insufficient inbox/calendar context", recoveryPrompt: "I need both inbox and calendar context to build your full daily plan." }],
  templates: {
    success: "Here is your unified inbox and calendar plan for today.",
    partial: "I created a partial plan and need one clarification to finalize it.",
    blocked: "I need the day/time window to build this plan.",
    failed: "I couldn't build your daily plan right now.",
  },
});
