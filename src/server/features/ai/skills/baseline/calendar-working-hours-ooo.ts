import { createBaselineSkill } from "./shared";

export const calendarWorkingHoursOooSkill = createBaselineSkill({
  id: "calendar_working_hours_ooo",
  intents: ["set working hours", "set out of office", "update my calendar availability settings"],
  requiredSlots: ["policy_type"],
  optionalSlots: ["workHourStart", "workHourEnd", "workDays", "ooo_window", "location", "timezone"],
  allowedTools: ["calendar.setWorkingHours", "calendar.setOutOfOffice"],
  plan: [
    { id: "set_working_hours", description: "Apply working-hours policy", capability: "calendar.setWorkingHours" },
    { id: "set_out_of_office", description: "Apply out-of-office policy", capability: "calendar.setOutOfOffice" },
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
