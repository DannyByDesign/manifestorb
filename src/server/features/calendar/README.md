# Calendar Utilities (`src/server/utils/calendar`)

Helpers for normalizing calendar data across providers (Google/Outlook).

## Key Files
-   **Event Parsing**: Helpers to convert raw API responses into uniform `CalendarEvent` objects.
-   **Timezone Handling**: Logic to resolve user timezone vs. event timezone.
-   **Availability**: Logic to compute "Free/Busy" slots.
