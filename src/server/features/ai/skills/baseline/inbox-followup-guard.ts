import { createBaselineSkill } from "./shared";

export const inboxFollowupGuardSkill = createBaselineSkill({
  id: "inbox_followup_guard",
  intents: ["what follow ups am I waiting on", "show awaiting reply risks", "follow up reminders"],
  requiredSlots: [],
  optionalSlots: ["high_priority_only"],
  allowedTools: ["email.searchThreads", "planner.composeDayPlan"],
  risk: "safe",
  plan: [
    { id: "search_awaiting", description: "Find awaiting-reply threads", capability: "email.searchThreads", requiredSlots: ["time_window"] },
    { id: "rank_risk", description: "Rank follow-up risk", capability: "planner.composeDayPlan" },
  ],
  successChecks: [{ id: "risk_list", description: "Risk list returned or explicit none-found" }],
  failureModes: [{ code: "NO_FOLLOWUPS", description: "No follow-up risks found", recoveryPrompt: "No active follow-up risks found in that window." }],
  templates: {
    success: "Here are your highest-risk follow-ups.",
    partial: "I found likely follow-ups but need one clarification for precision.",
    blocked: "I need a time window to check follow-up risk.",
    failed: "I couldn't evaluate follow-up risk right now.",
  },
});
