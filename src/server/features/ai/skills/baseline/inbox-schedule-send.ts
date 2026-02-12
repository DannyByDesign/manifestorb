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
  failureModes: [{ code: "SCHEDULE_NOT_SUPPORTED", description: "Schedule send unsupported in current capability", recoveryPrompt: "Scheduled send isn't available in this path yet. I can create a draft now and you can schedule from Gmail." }],
  templates: {
    success: "Done. I scheduled that draft to send.",
    partial: "I validated most scheduling details but need one clarification.",
    blocked: "I need both draft id and send time to schedule this.",
    failed: "I couldn't schedule that send right now.",
  },
});
