import { createBaselineSkill } from "./shared";

export const inboxBulkNewsletterCleanupSkill = createBaselineSkill({
  id: "inbox_bulk_newsletter_cleanup",
  intents: ["clean up newsletters", "archive promotions", "bulk clean inbox"],
  requiredSlots: ["target_scope"],
  optionalSlots: ["sender_allowlist", "age_threshold"],
  allowedTools: ["email.searchThreads", "email.batchArchive"],
  plan: [
    { id: "search_newsletters", description: "Find newsletter/promo candidates", capability: "email.searchThreads", requiredSlots: ["target_scope"] },
    { id: "archive_batch", description: "Archive candidate threads", capability: "email.batchArchive" },
  ],
  successChecks: [{ id: "archive_count", description: "Archived count is returned" }],
  failureModes: [{ code: "NO_CANDIDATES", description: "No newsletter candidates found", recoveryPrompt: "I couldn't find newsletter candidates in that range. Want me to expand the search?" }],
  templates: {
    success: "Done. I cleaned up newsletter and promotional threads.",
    partial: "I found candidates, but I need one filter clarified before bulk cleanup.",
    blocked: "I need a target scope (for example, today, this week, or older than 30 days).",
    failed: "I couldn't complete bulk newsletter cleanup right now.",
  },
});
