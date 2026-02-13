import { createBaselineSkill } from "./shared";

export const rulePlaneManagementSkill = createBaselineSkill({
  id: "rule_plane_management",
  intents: [
    "Show my current rules.",
    "Create a rule that always asks before sending to external domains.",
    "Preview this rule before activating it.",
    "Disable rule rule_123 until tomorrow.",
    "Delete that automation rule.",
  ],
  requiredSlots: ["rule_action"],
  optionalSlots: ["rule_id", "rule_type", "disabled_until", "rule_patch"],
  allowedTools: [
    "policy.listRules",
    "policy.compileRule",
    "policy.createRule",
    "policy.updateRule",
    "policy.disableRule",
    "policy.deleteRule",
  ],
  risk: "caution",
  requiresApproval: false,
  plan: [
    {
      id: "manage_rule_plane",
      description: "Route rule-plane action to the correct canonical rule capability",
      capability: "policy.createRule",
    },
  ],
  successChecks: [
    {
      id: "rule_plane_action_completed",
      description: "Rule-plane operation completes with success response",
    },
  ],
  failureModes: [
    {
      code: "RULE_ACTION_INVALID",
      description: "Rule action was missing or unsupported",
      recoveryPrompt:
        "Tell me whether you want to list, preview, create, update, disable, or delete a rule.",
    },
  ],
  templates: {
    success: "Rule-plane action completed.",
    partial: "Rule-plane action partially completed.",
    blocked: "I need more rule details before applying that.",
    failed: "I couldn't complete that rule request right now.",
  },
});
