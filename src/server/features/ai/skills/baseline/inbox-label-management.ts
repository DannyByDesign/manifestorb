import { createBaselineSkill } from "./shared";

export const inboxLabelManagementSkill = createBaselineSkill({
  id: "inbox_label_management",
  intents: [
    "add a label to these emails",
    "remove labels from this thread",
    "label inbox messages",
  ],
  requiredSlots: ["thread_ids", "label_ids"],
  optionalSlots: ["label_action"],
  allowedTools: ["email.applyLabels", "email.removeLabels"],
  plan: [
    {
      id: "apply_or_remove_labels",
      description: "Apply or remove labels on target emails",
      capability: "email.applyLabels",
      requiredSlots: ["thread_ids", "label_ids"],
    },
  ],
  successChecks: [{ id: "labels_updated", description: "Label mutation completed" }],
  failureModes: [
    {
      code: "MISSING_LABELS",
      description: "No labels were provided",
      recoveryPrompt: "Which label(s) should I apply or remove?",
    },
  ],
  templates: {
    success: "Label changes completed.",
    partial: "Some label changes completed, but a few items were skipped.",
    blocked: "I need target threads and label IDs to continue.",
    failed: "I couldn't update labels right now.",
  },
});
