import { createBaselineSkill } from "./shared";

export const calendarScheduleFromContextSkill = createBaselineSkill({
  id: "calendar_schedule_from_context",
  intents: ["schedule this meeting", "create an event", "book this on my calendar"],
  requiredSlots: ["title", "start", "duration"],
  optionalSlots: ["participants", "location", "agenda"],
  allowedTools: ["calendar.createEvent"],
  plan: [
    { id: "create_event", description: "Create event from context", capability: "calendar.createEvent", requiredSlots: ["title", "start", "duration"] },
  ],
  successChecks: [{ id: "event_id", description: "Event id returned" }],
  failureModes: [{ code: "ATTENDEE_AMBIGUITY", description: "Attendees are ambiguous", recoveryPrompt: "I need attendee emails to schedule this accurately." }],
  templates: {
    success: "Done. I scheduled the event.",
    partial: "I can schedule this once I confirm one missing detail.",
    blocked: "I need title, start time, and duration to schedule this event.",
    failed: "I couldn't schedule that event right now.",
  },
});
