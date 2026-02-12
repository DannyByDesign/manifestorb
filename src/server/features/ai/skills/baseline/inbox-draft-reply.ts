import { createBaselineSkill } from "./shared";

export const inboxDraftReplySkill = createBaselineSkill({
  id: "inbox_draft_reply",
  intents: ["draft a reply", "write a response", "compose an email reply"],
  requiredSlots: ["reply_intent"],
  optionalSlots: ["thread_id", "recipient", "tone", "length"],
  allowedTools: ["email.createDraft"],
  plan: [
    { id: "compose", description: "Compose reply draft text" },
    { id: "create_draft", description: "Create draft", capability: "email.createDraft", requiredSlots: ["reply_intent"] },
  ],
  successChecks: [{ id: "draft_id", description: "Draft id is returned" }],
  failureModes: [{ code: "MISSING_RECIPIENT", description: "Recipient could not be resolved", recoveryPrompt: "I need the recipient email to create this draft." }],
  templates: {
    success: "Draft created. You can review and send when ready.",
    partial: "I generated a draft outline but need one missing detail before saving it.",
    blocked: "I need the core reply intent (and recipient if not inferable) to draft this.",
    failed: "I couldn't create that draft right now.",
  },
});
