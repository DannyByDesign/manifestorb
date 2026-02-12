import { createBaselineSkill } from "./shared";

export const calendarWorkingHoursOooSkill = createBaselineSkill({
  id: "calendar_working_hours_ooo",
  intents: ["set working hours", "set out of office", "update my calendar availability settings"],
  requiredSlots: ["policy_type"],
  optionalSlots: ["working_hours", "ooo_window", "location", "timezone"],
  allowedTools: ["calendar.setWorkingHours", "calendar.setOutOfOffice"],
  plan: [
    { id: "apply_policy", description: "Apply working-hours or out-of-office policy" },
  ],
  successChecks: [{ id: "policy_saved", description: "Policy update confirmation returned" }],
  failureModes: [{ code: "INVALID_POLICY", description: "Provided policy shape is invalid", recoveryPrompt: "I need valid working-hours or out-of-office details to apply this." }],
  templates: {
    success: "Done. I updated your calendar boundary settings.",
    partial: "I applied part of your settings and need one clarification.",
    blocked: "I need either working hours or out-of-office details.",
    failed: "I couldn't update those calendar settings right now.",
  },
});
