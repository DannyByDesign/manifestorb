import { createBaselineSkill } from "./shared";

export const calendarEventDeleteOrCancelSkill = createBaselineSkill({
  id: "calendar_event_delete_or_cancel",
  intents: [
    "cancel this meeting",
    "delete this calendar event",
    "remove this event from my calendar",
  ],
  requiredSlots: ["event_id"],
  optionalSlots: ["mode"],
  allowedTools: ["calendar.deleteEvent"],
  risk: "dangerous",
  requiresApproval: true,
  plan: [
    {
      id: "delete_event",
      description: "Delete/cancel selected event",
      capability: "calendar.deleteEvent",
      requiredSlots: ["event_id"],
    },
  ],
  successChecks: [{ id: "event_deleted", description: "Event deletion confirmed" }],
  failureModes: [
    {
      code: "MISSING_EVENT",
      description: "No event id resolved",
      recoveryPrompt: "Which event should I cancel?",
    },
  ],
  templates: {
    success: "Event cancellation completed.",
    partial: "I cancelled part of the requested events.",
    blocked: "I need the event to cancel.",
    failed: "I couldn't cancel that event right now.",
  },
});
