import { createBaselineSkill } from "./shared";

export const calendarRecurringSeriesManagementSkill = createBaselineSkill({
  id: "calendar_recurring_series_management",
  intents: [
    "update this recurring meeting series",
    "change one instance only",
    "edit recurring event settings",
  ],
  requiredSlots: ["event_id", "mode"],
  optionalSlots: ["start", "end", "title"],
  allowedTools: ["calendar.updateRecurringMode"],
  plan: [
    {
      id: "update_recurring_mode",
      description: "Apply recurring event update using selected mode",
      capability: "calendar.updateRecurringMode",
      requiredSlots: ["event_id", "mode"],
    },
  ],
  successChecks: [{ id: "recurrence_updated", description: "Recurring update completed" }],
  failureModes: [
    {
      code: "MISSING_MODE",
      description: "No recurrence mode provided",
      recoveryPrompt: "Should I update only this instance or the whole series?",
    },
  ],
  templates: {
    success: "Recurring event updated.",
    partial: "I applied part of the recurring event update.",
    blocked: "I need the event and whether to update a single instance or full series.",
    failed: "I couldn't update that recurring event right now.",
  },
});
