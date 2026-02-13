import { createBaselineSkill } from "./shared";

export const inboxReplyOrForwardSendSkill = createBaselineSkill({
  id: "inbox_reply_or_forward_send",
  intents: [
    "reply and send now",
    "forward this email",
    "send this response directly",
  ],
  requiredSlots: ["thread_id", "body"],
  optionalSlots: ["recipient", "subject", "send_mode"],
  allowedTools: ["email.reply", "email.forward", "email.sendNow"],
  plan: [
    {
      id: "reply_or_forward_send",
      description: "Send reply or forward",
      capability: "email.reply",
      requiredSlots: ["thread_id", "body"],
    },
  ],
  successChecks: [{ id: "message_sent", description: "Message was sent successfully" }],
  failureModes: [
    {
      code: "MISSING_BODY",
      description: "No message body was provided",
      recoveryPrompt: "What should the reply/forward say?",
    },
  ],
  templates: {
    success: "Done. Your message was sent.",
    partial: "A send action was prepared, but one step needs clarification.",
    blocked: "I need message content and target context to send this.",
    failed: "I couldn't send that message right now.",
  },
});
