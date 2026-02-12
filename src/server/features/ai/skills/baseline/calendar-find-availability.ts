import { createBaselineSkill } from "./shared";

export const calendarFindAvailabilitySkill = createBaselineSkill({
  id: "calendar_find_availability",
  intents: ["find time to meet", "show availability", "when are we both free"],
  requiredSlots: ["participants", "date_window", "duration"],
  optionalSlots: ["timezone"],
  allowedTools: ["calendar.findAvailability"],
  risk: "safe",
  plan: [
    { id: "query_availability", description: "Find free slots", capability: "calendar.findAvailability", requiredSlots: ["participants", "date_window", "duration"] },
  ],
  successChecks: [{ id: "candidate_slots", description: "Candidate slots returned" }],
  failureModes: [{ code: "NO_OVERLAP", description: "No common free slots", recoveryPrompt: "I couldn't find overlapping availability. Want me to widen the date range or shorten duration?" }],
  templates: {
    success: "Here are candidate time slots.",
    partial: "I found partial availability and need one constraint clarified.",
    blocked: "I need participants, date window, and duration to find availability.",
    failed: "I couldn't compute availability right now.",
  },
});
