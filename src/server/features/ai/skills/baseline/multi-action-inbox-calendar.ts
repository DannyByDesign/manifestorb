import { createBaselineSkill } from "./shared";

export const multiActionInboxCalendarSkill = createBaselineSkill({
  id: "multi_action_inbox_calendar",
  intents: [
    "do these inbox and calendar actions together",
    "archive emails and reschedule meetings",
    "handle multiple tasks in one request",
  ],
  requiredSlots: ["composite_actions"],
  optionalSlots: ["priority_order", "time_window"],
  allowedTools: ["planner.compileMultiActionPlan", "planner.composeDayPlan"],
  plan: [
    {
      id: "compile_multi_action_plan",
      description: "Compile request into deterministic multi-action plan",
      capability: "planner.compileMultiActionPlan",
      requiredSlots: ["composite_actions"],
    },
  ],
  successChecks: [{ id: "multi_plan_compiled", description: "Composite plan generated" }],
  failureModes: [
    {
      code: "MISSING_ACTIONS",
      description: "No multi-action request shape extracted",
      recoveryPrompt: "Tell me the exact inbox and calendar actions you want in order.",
    },
  ],
  templates: {
    success: "I parsed your combined request and prepared an execution plan.",
    partial: "I parsed some actions, but need one more detail to run all of them.",
    blocked: "I need a clearer set of actions to execute this multi-step request.",
    failed: "I couldn't compile that multi-action request right now.",
  },
});
