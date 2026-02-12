import { createBaselineSkill } from "./shared";

export const inboxSnoozeOrDeferSkill = createBaselineSkill({
  id: "inbox_snooze_or_defer",
  intents: ["snooze this thread", "defer these emails", "remind me later"],
  requiredSlots: ["thread_ids", "defer_until"],
  optionalSlots: ["reason"],
  allowedTools: ["email.snoozeThread"],
  plan: [
    { id: "snooze", description: "Apply snooze/defer to target threads", capability: "email.snoozeThread", requiredSlots: ["thread_ids", "defer_until"] },
  ],
  successChecks: [{ id: "defer_applied", description: "All target threads report deferred state" }],
  failureModes: [{ code: "INVALID_DEFER_TIME", description: "Defer time is invalid or in the past", recoveryPrompt: "That defer time is invalid. Please provide a future date/time." }],
  templates: {
    success: "Done. I deferred those threads.",
    partial: "I deferred some threads, but need clarification for the rest.",
    blocked: "I need both the target thread(s) and a defer-until time.",
    failed: "I couldn't defer those threads right now.",
  },
});
