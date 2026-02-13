import { createBaselineSkill } from "./shared";

export const calendarReadLookupSkill = createBaselineSkill({
  id: "calendar_read_lookup",
  intents: [
    "what is my next meeting",
    "what is my first meeting today",
  ],
  requiredSlots: [],
  optionalSlots: ["lookup_mode", "date_window"],
  allowedTools: ["calendar.listEvents"],
  risk: "safe",
  requiresApproval: false,
  plan: [
    {
      id: "lookup_calendar_item",
      description: "Find the requested calendar event",
      capability: "calendar.listEvents",
    },
  ],
  successChecks: [
    {
      id: "calendar_item_answered",
      description: "Returns a concrete calendar event or explicit no-results answer",
    },
  ],
  failureModes: [
    {
      code: "CALENDAR_LOOKUP_EMPTY",
      description: "No calendar event matched the lookup request",
      recoveryPrompt:
        "I couldn't find a matching meeting. Want me to check a wider time window?",
    },
  ],
  templates: {
    success: "I found the calendar event you asked about.",
    partial: "I found related calendar events but need one clarification.",
    blocked: "I need one more detail to identify the right calendar event.",
    failed: "I couldn't retrieve that calendar event right now.",
  },
});
