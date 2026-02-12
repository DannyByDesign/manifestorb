import { createBaselineSkill } from "./shared";

export const inboxTriageTodaySkill = createBaselineSkill({
  id: "inbox_triage_today",
  intents: ["triage my inbox", "what should I reply to today", "prioritize my inbox"],
  requiredSlots: ["time_window"],
  optionalSlots: ["priority_bias"],
  allowedTools: ["email.searchThreads"],
  plan: [
    { id: "search", description: "Search today's actionable threads", capability: "email.searchThreads", requiredSlots: ["time_window"] },
    { id: "rank", description: "Rank urgency and actionable state" },
  ],
  successChecks: [{ id: "ranked_threads", description: "Returns ranked actionable threads or explicit no-results" }],
  failureModes: [{ code: "NO_ACTIONABLE", description: "No actionable emails found", recoveryPrompt: "I couldn't find urgent action items for today. Want me to broaden to this week?" }],
  templates: {
    success: "Here are your top inbox actions for today.",
    partial: "I found some likely priorities, but need one clarification.",
    blocked: "I need your preferred time window to triage accurately.",
    failed: "I couldn't complete inbox triage right now.",
  },
});
