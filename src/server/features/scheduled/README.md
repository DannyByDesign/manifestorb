# Scheduled Actions (`src/server/features/scheduled`)

Scheduling and execution of deferred actions (cron-like tasks inside the app domain).

## Key Files

- `scheduler.ts`: schedules work
- `executor.ts`: executes scheduled items

If you change scheduling semantics, update `scheduler.test.ts` and `executor.test.ts`.

