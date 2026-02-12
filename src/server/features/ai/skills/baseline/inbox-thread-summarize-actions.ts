import { createBaselineSkill } from "./shared";

export const inboxThreadSummarizeActionsSkill = createBaselineSkill({
  id: "inbox_thread_summarize_actions",
  intents: ["summarize this thread", "what are the action items", "summarize decisions and deadlines"],
  requiredSlots: ["thread_id"],
  optionalSlots: ["summary_style"],
  allowedTools: ["email.searchThreads"],
  risk: "safe",
  plan: [
    { id: "load_thread", description: "Load target thread context", capability: "email.searchThreads", requiredSlots: ["thread_id"] },
    { id: "summarize", description: "Extract decisions, actions, and deadlines" },
  ],
  successChecks: [{ id: "summary_sections", description: "Response includes decisions/actions/deadlines sections" }],
  failureModes: [{ code: "THREAD_NOT_FOUND", description: "Thread could not be loaded", recoveryPrompt: "I couldn't load that thread. Please share the thread context again." }],
  templates: {
    success: "Here's the thread summary with decisions, action items, and deadlines.",
    partial: "I found part of the thread context but need one clarification.",
    blocked: "I need a thread reference to summarize actions.",
    failed: "I couldn't summarize that thread right now.",
  },
});
