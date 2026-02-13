import { createBaselineSkill } from "./shared";

export const inboxReadLookupSkill = createBaselineSkill({
  id: "inbox_read_lookup",
  intents: [
    "what is the first email in my inbox",
    "what is the latest email",
    "what is my oldest unread email",
  ],
  requiredSlots: [],
  optionalSlots: ["lookup_mode", "lookup_query"],
  allowedTools: ["email.searchInbox"],
  risk: "safe",
  requiresApproval: false,
  plan: [
    {
      id: "lookup_inbox_item",
      description: "Find the requested inbox item",
      capability: "email.searchInbox",
    },
  ],
  successChecks: [
    {
      id: "inbox_item_answered",
      description: "Returns a concrete inbox item or explicit no-results answer",
    },
  ],
  failureModes: [
    {
      code: "INBOX_LOOKUP_EMPTY",
      description: "No inbox items matched the lookup request",
      recoveryPrompt:
        "I couldn't find a matching inbox item. Want me to expand the search window?",
    },
  ],
  templates: {
    success: "I found the inbox item you asked about.",
    partial: "I found related inbox items but need one clarification.",
    blocked: "I need one more detail to identify the right inbox item.",
    failed: "I couldn't retrieve that inbox item right now.",
  },
});
