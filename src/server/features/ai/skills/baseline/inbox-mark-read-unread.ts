import { createBaselineSkill } from "./shared";

export const inboxMarkReadUnreadSkill = createBaselineSkill({
  id: "inbox_mark_read_unread",
  intents: [
    "mark these emails as read",
    "mark this thread unread",
    "set message read state",
  ],
  requiredSlots: ["thread_ids"],
  optionalSlots: ["read"],
  allowedTools: ["email.markReadUnread"],
  plan: [
    {
      id: "mark_read_state",
      description: "Set read/unread state for target emails",
      capability: "email.markReadUnread",
      requiredSlots: ["thread_ids"],
    },
  ],
  successChecks: [{ id: "read_state_updated", description: "Read state updated" }],
  failureModes: [
    {
      code: "MISSING_THREADS",
      description: "No target thread IDs were resolved",
      recoveryPrompt: "Which thread(s) should I mark read or unread?",
    },
  ],
  templates: {
    success: "Done. I updated the read state.",
    partial: "I updated some threads, but not all of them.",
    blocked: "I need the thread(s) you want to mark read or unread.",
    failed: "I couldn't update read state right now.",
  },
});
