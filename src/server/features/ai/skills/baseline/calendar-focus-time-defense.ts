import { createBaselineSkill } from "./shared";

export const calendarFocusTimeDefenseSkill = createBaselineSkill({
  id: "calendar_focus_time_defense",
  intents: ["block focus time", "protect deep work", "create focus blocks"],
  requiredSlots: ["focus_block_window"],
  optionalSlots: ["auto_decline"],
  allowedTools: ["calendar.createFocusBlock"],
  plan: [
    { id: "create_focus", description: "Create focus block", capability: "calendar.createFocusBlock", requiredSlots: ["focus_block_window"] },
  ],
  successChecks: [{ id: "focus_block_created", description: "Focus block creation confirmed" }],
  failureModes: [{ code: "FOCUS_CONFLICT", description: "Focus block conflicts with non-movable events", recoveryPrompt: "That focus block conflicts with existing events. Want alternative windows?" }],
  templates: {
    success: "Done. I protected focus time on your calendar.",
    partial: "I created some focus coverage but need one clarification for full coverage.",
    blocked: "I need the focus block time window.",
    failed: "I couldn't set focus time right now.",
  },
});
