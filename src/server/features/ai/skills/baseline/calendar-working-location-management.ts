import { createBaselineSkill } from "./shared";

export const calendarWorkingLocationManagementSkill = createBaselineSkill({
  id: "calendar_working_location_management",
  intents: [
    "set my working location",
    "mark me as remote today",
    "update office location in calendar",
  ],
  requiredSlots: ["working_location"],
  optionalSlots: ["time_window"],
  allowedTools: ["calendar.setWorkingLocation"],
  plan: [
    {
      id: "set_working_location",
      description: "Apply working location preference",
      capability: "calendar.setWorkingLocation",
      requiredSlots: ["working_location"],
    },
  ],
  successChecks: [{ id: "working_location_set", description: "Working location update accepted" }],
  failureModes: [
    {
      code: "MISSING_LOCATION",
      description: "No location specified",
      recoveryPrompt: "What working location should I set?",
    },
  ],
  templates: {
    success: "Working location updated.",
    partial: "I captured part of your working location update.",
    blocked: "I need the location you want to set.",
    failed: "I couldn't update working location right now.",
  },
});
