# Issue 22: Make SCHEDULE_MEETING Constants Configurable

**Severity:** LOW
**Category:** Hardcoded Business Logic

---

## Problem

In `src/server/features/ai/actions.ts` (lines 599-601), three constants control SCHEDULE_MEETING behavior:

```typescript
const SCHEDULE_MEETING_DURATION_MINUTES = 30;
const SCHEDULE_MEETING_SLOT_COUNT = 3;
const SCHEDULE_MEETING_EXPIRY_SECONDS = 86_400; // 24 hours
```

All users get 30-minute meeting slots, 3 options, and 24-hour expiry. A user who typically has 15-minute meetings or wants 5 slot options cannot customize this.

---

## Root Cause

These were hardcoded during the SCHEDULE_MEETING implementation. No per-user configuration was added.

---

## Step-by-Step Fix

### Step 1: Add fields to TaskPreference (or UserAIConfig)

**Option A:** Add to existing `TaskPreference` model (since it already has scheduling settings):

**File:** `prisma/schema.prisma`

```prisma
model TaskPreference {
  // ... existing fields ...
  defaultMeetingDurationMin Int @default(30)
  meetingSlotCount          Int @default(3)
  meetingExpirySeconds      Int @default(86400)
}
```

**Option B:** If Issue 21's `UserAIConfig` is implemented, add there instead.

### Step 2: Create the migration

```bash
bunx prisma migrate dev --name add_meeting_preferences
```

### Step 3: Load preferences in the SCHEDULE_MEETING action

**File:** `src/server/features/ai/actions.ts`

In the `schedule_meeting` function (around line 610), replace hardcoded constants:

```typescript
const schedule_meeting: ActionFunction<Record<string, unknown>> = async ({
  client, email, userId, emailAccountId, logger,
}) => {
  // Load user preferences
  const prefs = await prisma.taskPreference.findUnique({
    where: { userId },
    select: {
      defaultMeetingDurationMin: true,
      meetingSlotCount: true,
      meetingExpirySeconds: true,
    },
  });

  const durationMinutes = prefs?.defaultMeetingDurationMin ?? 30;
  const slotCount = prefs?.meetingSlotCount ?? 3;
  const expirySeconds = prefs?.meetingExpirySeconds ?? 86_400;

  // ... rest of function, using durationMinutes, slotCount, expirySeconds
  // instead of SCHEDULE_MEETING_DURATION_MINUTES, etc.
```

### Step 4: Replace all references to the constants

In the same function, replace:

- `SCHEDULE_MEETING_DURATION_MINUTES` -> `durationMinutes`
- `SCHEDULE_MEETING_SLOT_COUNT` -> `slotCount`
- `SCHEDULE_MEETING_EXPIRY_SECONDS` -> `expirySeconds`

### Step 5: Delete the old constants

Remove lines 599-601:

```typescript
// DELETE THESE:
const SCHEDULE_MEETING_DURATION_MINUTES = 30;
const SCHEDULE_MEETING_SLOT_COUNT = 3;
const SCHEDULE_MEETING_EXPIRY_SECONDS = 86_400;
```

### Step 6: Also use SchedulingInsights for duration (ties to Issue 19)

If Issue 19 is implemented, use the learned median meeting duration as the default:

```typescript
const insights = await prisma.schedulingInsights.findUnique({
  where: { userId },
  select: { medianMeetingDurationMin: true },
});
const durationMinutes = prefs?.defaultMeetingDurationMin
  ?? insights?.medianMeetingDurationMin
  ?? 30;
```

---

## Files to Modify

- `prisma/schema.prisma` -- add meeting preference fields to `TaskPreference`
- `src/server/features/ai/actions.ts` -- load preferences, replace constants

## Files to Create

- `prisma/migrations/<timestamp>_add_meeting_preferences/migration.sql` (auto-generated)

## Testing Instructions

1. Apply migration: `bunx prisma migrate dev`
2. Verify TypeScript compiles: `bunx tsc --noEmit`
3. Set `defaultMeetingDurationMin: 15` for a test user
4. Trigger SCHEDULE_MEETING and verify 15-minute slots are proposed
5. Run E2E test: `bunx vitest run src/__tests__/e2e/`

## Rollback Plan

Drop the new columns and restore the hardcoded constants.

## Dependencies on Other Issues

- **Issue 19** (adaptive scheduling): Can provide learned defaults as fallback.
- **Issue 08** (settings via AI): Users should be able to say "make my default meeting length 45 minutes."
