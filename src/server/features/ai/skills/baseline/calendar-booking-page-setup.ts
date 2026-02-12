import { createBaselineSkill } from "./shared";

export const calendarBookingPageSetupSkill = createBaselineSkill({
  id: "calendar_booking_page_setup",
  intents: ["set up my booking page", "configure appointment schedule", "create booking slots"],
  requiredSlots: ["schedule_window", "slot_duration"],
  optionalSlots: ["buffers", "daily_cap"],
  allowedTools: ["calendar.createBookingSchedule"],
  plan: [
    { id: "create_booking_schedule", description: "Create booking schedule", capability: "calendar.createBookingSchedule", requiredSlots: ["schedule_window", "slot_duration"] },
  ],
  successChecks: [{ id: "booking_setup", description: "Booking schedule setup confirmation returned" }],
  failureModes: [{ code: "BOOKING_NOT_SUPPORTED", description: "Booking schedule capability unavailable", recoveryPrompt: "Booking page setup isn't available in this runtime path yet." }],
  templates: {
    success: "Done. I configured your booking schedule.",
    partial: "I can finish booking setup once one setting is clarified.",
    blocked: "I need schedule window and slot duration.",
    failed: "I couldn't set up booking schedule right now.",
  },
});
