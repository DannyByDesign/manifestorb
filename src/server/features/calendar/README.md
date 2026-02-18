# Calendar Features (`src/server/features/calendar`)

Core calendar primitives, provider adapters, and scheduling engine plumbing.

## Key Files
- **Provider plumbing**:
  - Low-level CRUD lives in `src/server/integrations/google|microsoft/`.
  - `providers/*`: provider adapters that call integrations and expose a unified API.
  - `event-provider.ts`: builds `CalendarEventProvider` instances for connected accounts.
  - `event-types.ts`: shared calendar shapes + read/write interfaces.
- **Scheduling engine**:
  - `scheduling/CalendarServiceImpl.ts`: conflict detection + calendar event caching.
  - `scheduling/TimeSlotManager.ts`: generates candidate slots, filters by work hours, scores.
  - `scheduling/SchedulingService.ts`: orchestrates multi-task scheduling.
  - `scheduling/TaskSchedulingService.ts`: entry point for user-level scheduling runs.
  - `scheduling/adapters/CalendarProviderAdapter.ts`: bridges provider events into scheduling.
- **Guardrails + observability**:
  - `action-log.ts`: audit logging for calendar mutations.
  - Env flag: `NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED`.
- **Availability utilities**:
  - `ai/availability.ts`, `unified-availability.ts`: provider-agnostic availability helpers.

## Agentic Readiness
This directory provides event access, scheduling, conflict checks, and watch renewal.
- **Agent tools**: Calendar event create/update/delete wired into AI tools (draft-first; user approval). Query/get use calendar provider.
- **Schedule something**: AI proposes 1–3 slots; user selects via chat (e.g. 1/2/3) or approval UI.
- **Conflict resolution**: Webhook detects external calendar changes (deduped); schedule proposal + resolver + verbal selection.
- **Watch renewal**: Cron `POST /api/google/calendar/watch/renew` (CRON_SECRET). Feature flag: `NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED`.

## Internal Reconcile (Worker)
- Surfaces worker runs a reconciliation job that calls `POST /api/calendar/sync/reconcile`.
- The main app validates the request using `isValidInternalApiKey` and the `x-api-key` header.
- Required env vars:
  - Main app: `INTERNAL_API_KEY`
  - Worker process: `INTERNAL_API_KEY` (and optional `CORE_BASE_URL` override)

## Scheduling Account Resolution
- When scheduling tasks, the system resolves the `emailAccountId` from `TaskPreference.selectedCalendarIds`.
- If no calendars are selected, it falls back to the user's earliest connected email account.
- Explicit `calendarId` in tool calls always overrides preferences without changing them.
