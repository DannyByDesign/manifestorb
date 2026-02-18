# Booking Schedule: Real Implementation (Google Calendar)

## Context
The question bank includes `CM-014`:

- "Create a booking schedule for 30-min meetings next week." -> `calendar.createBookingSchedule`

We currently treat this as "save booking link + meeting slot preferences" (EmailAccount.calendarBookingLink + TaskPreference fields). This does not create an actual bookable schedule/page.

## Problem
Users expect a real booking experience (link they can share + slot selection + event creation) or an equivalent Google-native artifact.

## Proposed Directions
Pick one:

1. Implement internal booking pages
- New DB model for booking schedules (slug/token, duration, window rules, limits)
- Public route under `NEXT_PUBLIC_BASE_URL` that shows available slots
- Confirm flow creates Google Calendar event on the selected calendar

2. Implement Google Calendar appointment schedules
- Use Google Calendar API support for appointment schedules (if feasible)

## Acceptance Criteria
- `calendar.createBookingSchedule` returns a shareable link when no bookingLink is provided.
- Visiting the link shows available slots consistent with user calendars and configured windows.
- Booking a slot creates a calendar event and returns confirmation.
- Works with Google Calendar only.
