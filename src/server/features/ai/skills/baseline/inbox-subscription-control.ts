import { createBaselineSkill } from "./shared";

export const inboxSubscriptionControlSkill = createBaselineSkill({
  id: "inbox_subscription_control",
  intents: ["unsubscribe from this sender", "stop these subscriptions", "block this newsletter"],
  requiredSlots: ["sender_or_domain"],
  optionalSlots: ["action"],
  allowedTools: ["email.searchThreads", "email.unsubscribeSender"],
  plan: [
    { id: "find_sender_threads", description: "Find sender/domain threads", capability: "email.searchThreads", requiredSlots: ["sender_or_domain"] },
    { id: "unsubscribe", description: "Apply unsubscribe control", capability: "email.unsubscribeSender" },
  ],
  successChecks: [{ id: "unsubscribe_status", description: "Returns unsubscribe action status" }],
  failureModes: [{ code: "NO_UNSUBSCRIBE_PATH", description: "Sender has no unsubscribe metadata", recoveryPrompt: "I couldn't find an unsubscribe path for that sender. Want me to archive or block future messages instead?" }],
  templates: {
    success: "Done. I applied subscription control for that sender.",
    partial: "I found multiple sender matches and need one clarification.",
    blocked: "I need the sender or domain to manage subscriptions.",
    failed: "I couldn't complete subscription control right now.",
  },
});
