import { createBaselineSkill } from "./shared";

export const inboxMoveOrSpamControlSkill = createBaselineSkill({
  id: "inbox_move_or_spam_control",
  intents: [
    "move these emails to a folder",
    "mark this thread as spam",
    "junk this sender thread",
  ],
  requiredSlots: ["thread_ids"],
  optionalSlots: ["folder_name", "action_type"],
  allowedTools: ["email.moveThread", "email.markSpam"],
  plan: [
    {
      id: "move_or_spam",
      description: "Move thread or mark as spam",
      capability: "email.moveThread",
      requiredSlots: ["thread_ids"],
    },
  ],
  successChecks: [{ id: "move_or_spam_done", description: "Action applied" }],
  failureModes: [
    {
      code: "MISSING_TARGET",
      description: "No target thread was identified",
      recoveryPrompt: "Which thread should I move or mark as spam?",
    },
  ],
  templates: {
    success: "Done. I applied the inbox control action.",
    partial: "Some inbox control actions completed, but not all.",
    blocked: "I need the target thread and destination/action.",
    failed: "I couldn't apply that inbox control right now.",
  },
});
