import { createBaselineSkill } from "./shared";

export const calendarMeetingLoadRebalanceSkill = createBaselineSkill({
  id: "calendar_meeting_load_rebalance",
  intents: ["rebalance my meetings", "reduce meeting load", "reclaim focus time"],
  requiredSlots: ["analysis_window"],
  optionalSlots: ["max_meetings_per_day"],
  allowedTools: ["calendar.findAvailability", "planner.composeDayPlan"],
  risk: "safe",
  plan: [
    { id: "analyze_load", description: "Analyze meeting density", capability: "calendar.findAvailability", requiredSlots: ["analysis_window"] },
    { id: "recommend_rebalance", description: "Generate rebalance recommendations", capability: "planner.composeDayPlan" },
  ],
  successChecks: [{ id: "rebalance_plan", description: "Returns actionable rebalance plan" }],
  failureModes: [{ code: "NO_REBALANCE_OPTIONS", description: "No practical rebalance options found", recoveryPrompt: "I couldn't find safe rebalance options. Want me to surface lowest-priority meetings instead?" }],
  templates: {
    success: "Here is a meeting-load rebalance plan.",
    partial: "I found a partial rebalance plan and need one constraint clarified.",
    blocked: "I need an analysis window to rebalance meetings.",
    failed: "I couldn't build a rebalance plan right now.",
  },
});
