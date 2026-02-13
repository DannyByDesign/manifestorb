import { createBaselineSkill } from "./shared";

export const inboxFilterManagementSkill = createBaselineSkill({
  id: "inbox_filter_management",
  intents: [
    "create a filter for this sender",
    "delete that email filter",
    "manage inbox filters",
  ],
  requiredSlots: ["sender_or_domain"],
  optionalSlots: ["filter_id", "label_name", "filter_action"],
  allowedTools: ["email.createFilter", "email.deleteFilter", "email.listFilters"],
  plan: [
    {
      id: "manage_filter",
      description: "Create/delete/list filters based on request",
      capability: "email.createFilter",
      requiredSlots: ["sender_or_domain"],
    },
  ],
  successChecks: [{ id: "filter_updated", description: "Filter action completed" }],
  failureModes: [
    {
      code: "MISSING_SENDER",
      description: "No sender/domain provided",
      recoveryPrompt: "Which sender/domain should this filter target?",
    },
  ],
  templates: {
    success: "Filter update completed.",
    partial: "I completed part of your filter request.",
    blocked: "I need the target sender/domain (or filter id for delete).",
    failed: "I couldn't update filters right now.",
  },
});
