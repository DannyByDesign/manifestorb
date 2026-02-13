import { createBaselineSkill } from "./shared";

export const calendarRescheduleWithConstraintsSkill = createBaselineSkill({
  id: "calendar_reschedule_with_constraints",
  intents: ["reschedule this meeting", "move this event", "find a new time for this"],
  requiredSlots: ["event_id"],
  optionalSlots: ["reschedule_window", "must_keep_duration", "must_keep_attendees"],
  allowedTools: ["calendar.findAvailability", "calendar.rescheduleEvent"],
  plan: [
    { id: "find_candidate_slot", description: "Find candidate slot", capability: "calendar.findAvailability", requiredSlots: ["reschedule_window"] },
    { id: "reschedule", description: "Apply reschedule", capability: "calendar.rescheduleEvent", requiredSlots: ["event_id"] },
  ],
  successChecks: [{ id: "event_moved", description: "Event moved and constraints preserved" }],
  failureModes: [{ code: "NO_VALID_SLOT", description: "No valid slots found with constraints", recoveryPrompt: "No valid slot fits those constraints. Want to relax one constraint?" }],
  templates: {
    success: "Done. I rescheduled the event.",
    partial: "I found options but need one constraint clarified.",
    blocked: "I need the target event to reschedule.",
    failed: "I couldn't reschedule that event right now.",
  },
});
