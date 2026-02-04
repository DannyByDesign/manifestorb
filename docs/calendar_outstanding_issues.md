# Calendar Integration Outstanding Issues

This report captures remaining gaps and inconsistencies across the calendar plumbing, provider integrations, and AI tool wiring. It reflects the current architecture goal: **low-level provider API plumbing in `src/server/integrations/*`** and **orchestration/agent logic in `src/server/features/calendar/*`**, with the sidecar acting only as a UI/transport layer.

## 1) AI Tool Wiring Gaps (Agentic Calendar Blockers)(complete)

- **Calendar CRUD not exposed to tools**
  - `create.ts` only returns availability slots; does not create events.
  - `modify.ts`, `delete.ts`, and `get.ts` return “not implemented.”
  - `providers/calendar.ts` only exposes `searchEvents` + `findAvailableSlots`.

**Impact:** The agent cannot create/update/delete calendar events from any surface (web, Telegram, Slack).

## 2) Provider Interface vs Integration Helper Mismatch(complete)

- Integrations (`src/server/integrations/google|microsoft/calendar.ts`) implement CRUD and advanced recurrence handling.
- Providers (`features/calendar/providers/*`) previously only implemented read-only methods.
- Provider `getEvent` does **not** call the integration `getGoogleEvent` / `getOutlookEvent`, which include recurrence instance logic.

**Impact:** Read behavior can diverge from integration behavior (especially recurring events).

## 3) Outlook Recurrence “single occurrence” Not Implemented

- `updateOutlookEvent` does not handle `mode: "single"` for recurring events.
- `deleteOutlookEvent` does not handle `mode: "single"` for recurring events.

**Impact:** Editing or deleting a single occurrence of a recurring Outlook event is broken.

## 4) Calendar Selection Not Wired(complete)

- Google provider uses `"primary"`; Microsoft uses `/me/events` (default calendar).
- `TaskPreference.selectedCalendarIds` exists but is not used in AI tool provider.

**Impact:** Agent can’t reliably target a user-selected calendar when multiple are connected.

## 5) Scheduling Engine Not Wired(complete)

- `TaskSchedulingService.scheduleTasksForUser` exists but is never invoked.
- No API route or scheduled job triggers scheduling.
- `TaskSchedule` model exists but is not used in code.

**Impact:** Scheduling logic never runs unless manually invoked.

## 6) Missing EmailAccount Resolution for Scheduling (complete)

`scheduleTasksForUser` requires an `emailAccountId`, but it does not resolve it from `userId`, and no selection logic exists for multi-account users.

**Impact:** Scheduling is undefined or broken for users with multiple email accounts.

## 7) Timezone Conversion Bug in Scheduling (complete)

`toZonedTime` converts by stringifying a locale, which loses timezone context and can be inaccurate.

**Impact:** Time slot generation can be incorrect across time zones.

## 8) Feature Flag Not Enforced in Scheduling Service (complete)

`NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED` is checked in AI tools, but not in `TaskSchedulingService`.

**Impact:** Scheduling can run when the feature should be off.

## 9) Sidecar Interaction Gaps(complete)

Sidecar is interface-only. However:
- It does not yet handle calendar-specific interactive actions (create/update/delete).
- Even if brain can schedule or create events, Telegram/Slack won’t surface approvals or actions yet.

**Impact:** Agentic calendar actions can’t be safely executed from sidecar surfaces.

---

## Recommended Next Steps (High-Level)

1. **Expose calendar CRUD through AI tools** (create/modify/delete/get).
2. **Fix Outlook single-occurrence update/delete** in integration layer.
3. **Add calendar selection logic** (use `selectedCalendarIds`, fallback to primary).
4. **Wire scheduling entry point** (API or job trigger).
5. **Fix timezone conversion** in scheduling utilities.
6. **Add sidecar action handlers** for calendar-specific interactive payloads.

If you want, I can expand this into a sequenced execution plan or start wiring the CRUD tools immediately.
