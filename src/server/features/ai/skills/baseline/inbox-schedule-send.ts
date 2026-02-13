import { createBaselineSkill } from "./shared";

export const inboxScheduleSendSkill = createBaselineSkill({
  id: "inbox_schedule_send",
  intents: ["schedule this email", "send this tomorrow morning", "queue this draft"],
  requiredSlots: ["draft_id", "send_time"],
  optionalSlots: ["timezone"],
  allowedTools: ["email.scheduleSend"],
  plan: [
    { id: "schedule_send", description: "Schedule draft send", capability: "email.scheduleSend", requiredSlots: ["draft_id", "send_time"] },
  ],
  successChecks: [{ id: "schedule_confirmed", description: "Scheduled send confirmation returned" }],
  failureModes: [{ code: "SCHEDULE_FAILED", description: "Scheduled send could not be queued", recoveryPrompt: "I couldn't queue that scheduled send. I can create or refresh the draft and try one more time." }],
  templates: {
    success: "Done. I scheduled that draft to send.",
    partial: "I validated most scheduling details but need one clarification.",
    blocked: "I need both draft id and send time to schedule this.",
    failed: "I couldn't schedule that send right now.",
  },
});
