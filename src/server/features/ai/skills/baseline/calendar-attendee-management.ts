import { createBaselineSkill } from "./shared";

export const calendarAttendeeManagementSkill = createBaselineSkill({
  id: "calendar_attendee_management",
  intents: [
    "add attendees to this event",
    "update meeting participants",
    "remove and set event attendees",
  ],
  requiredSlots: ["event_id", "participants"],
  optionalSlots: ["mode"],
  allowedTools: ["calendar.manageAttendees"],
  plan: [
    {
      id: "manage_attendees",
      description: "Update attendee list",
      capability: "calendar.manageAttendees",
      requiredSlots: ["event_id", "participants"],
    },
  ],
  successChecks: [{ id: "attendees_updated", description: "Attendee update completed" }],
  failureModes: [
    {
      code: "MISSING_ATTENDEES",
      description: "No participants resolved",
      recoveryPrompt: "Who should be added/kept on this event?",
    },
  ],
  templates: {
    success: "Attendees updated.",
    partial: "Some attendee updates were applied.",
    blocked: "I need event and attendee details to continue.",
    failed: "I couldn't update attendees right now.",
  },
});
