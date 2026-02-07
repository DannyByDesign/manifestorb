# Issue 19: Make Scheduling Constraints Adaptive Based on User Behavior

**Severity:** MEDIUM
**Category:** Hardcoded Business Logic

---

## Problem

`src/server/features/calendar/scheduling/TimeSlotManager.ts` contains hardcoded scheduling constants:

- **Line 7:** `DEFAULT_TASK_DURATION = 30` minutes -- always suggests 30-min slots regardless of user patterns
- **Line 170:** `MINIMUM_BUFFER_MINUTES = 15` -- fixed 15-min buffer between meetings
- **Lines 220-255:** Work hours filtering uses rigid comparison logic (`startHour >= workHourStart && endHour <= workHourEnd`)

Even though work hour values come from `TaskPreference` settings, the filtering logic itself is rigid (no soft boundaries, no learning from actual behavior).

---

## Root Cause

Scheduling was implemented with static defaults. No mechanism exists to learn from the user's actual calendar patterns.

---

## Step-by-Step Fix

### Step 1: Add a `SchedulingInsights` model to store learned patterns

**File:** `prisma/schema.prisma`

```prisma
model SchedulingInsights {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  userId String @unique
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Learned from calendar event history
  avgMeetingDurationMin   Float?   // Average meeting duration
  medianMeetingDurationMin Float?  // Median meeting duration
  avgBufferMin            Float?   // Average gap between meetings
  actualWorkHourStart     Float?   // e.g., 8.5 = 8:30 AM
  actualWorkHourEnd       Float?   // e.g., 18.0 = 6:00 PM
  activeWorkDays          Int[]    // Days the user actually has meetings [0-6]
  lastAnalyzedAt          DateTime?

  @@index([userId])
}
```

### Step 2: Create a migration

```bash
bunx prisma migrate dev --name add_scheduling_insights
```

### Step 3: Create a learning function that analyzes calendar history

**File:** `src/server/features/calendar/scheduling/insights.ts` (NEW FILE)

```typescript
import prisma from "@/server/db/client";

/**
 * Analyze the user's calendar events from the past 30 days
 * and update SchedulingInsights with learned patterns.
 */
export async function updateSchedulingInsights(userId: string): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Fetch recent calendar events
  // NOTE: Adjust the model/table name based on actual schema.
  // Calendar events may be stored via CalendarActionLog or fetched from provider.
  const events = await prisma.calendarActionLog.findMany({
    where: {
      userId,
      action: "create",
      createdAt: { gte: thirtyDaysAgo },
      payload: { not: null },
    },
    select: { payload: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  if (events.length < 5) {
    // Not enough data to learn from
    return;
  }

  // Extract durations and times from event payloads
  const durations: number[] = [];
  const startHours: number[] = [];
  const endHours: number[] = [];
  const workDaySet = new Set<number>();

  for (const event of events) {
    const payload = event.payload as Record<string, unknown> | null;
    if (!payload) continue;

    const start = payload.start ? new Date(payload.start as string) : null;
    const end = payload.end ? new Date(payload.end as string) : null;

    if (start && end) {
      const durationMin = (end.getTime() - start.getTime()) / (1000 * 60);
      if (durationMin > 0 && durationMin < 480) {
        durations.push(durationMin);
      }
      startHours.push(start.getHours() + start.getMinutes() / 60);
      endHours.push(end.getHours() + end.getMinutes() / 60);
      workDaySet.add(start.getDay());
    }
  }

  // Calculate statistics
  const sorted = [...durations].sort((a, b) => a - b);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const medianDuration = sorted[Math.floor(sorted.length / 2)];

  const avgStart = startHours.reduce((a, b) => a + b, 0) / startHours.length;
  const avgEnd = endHours.reduce((a, b) => a + b, 0) / endHours.length;

  // Upsert insights
  await prisma.schedulingInsights.upsert({
    where: { userId },
    update: {
      avgMeetingDurationMin: Math.round(avgDuration),
      medianMeetingDurationMin: Math.round(medianDuration),
      actualWorkHourStart: Math.round(avgStart * 2) / 2, // Round to nearest 0.5
      actualWorkHourEnd: Math.round(avgEnd * 2) / 2,
      activeWorkDays: Array.from(workDaySet).sort(),
      lastAnalyzedAt: new Date(),
    },
    create: {
      userId,
      avgMeetingDurationMin: Math.round(avgDuration),
      medianMeetingDurationMin: Math.round(medianDuration),
      actualWorkHourStart: Math.round(avgStart * 2) / 2,
      actualWorkHourEnd: Math.round(avgEnd * 2) / 2,
      activeWorkDays: Array.from(workDaySet).sort(),
      lastAnalyzedAt: new Date(),
    },
  });
}
```

### Step 4: Use insights in TimeSlotManager

**File:** `src/server/features/calendar/scheduling/TimeSlotManager.ts`

Replace the hardcoded `DEFAULT_TASK_DURATION` with an insights-aware function:

```typescript
// Before (line 7):
const DEFAULT_TASK_DURATION = 30;

// After:
async function getDefaultTaskDuration(userId: string): Promise<number> {
  const insights = await prisma.schedulingInsights.findUnique({
    where: { userId },
    select: { medianMeetingDurationMin: true },
  });
  return insights?.medianMeetingDurationMin ?? 30;
}
```

Replace the hardcoded `MINIMUM_BUFFER_MINUTES`:

```typescript
// Before (line 170):
const MINIMUM_BUFFER_MINUTES = 15;

// After:
async function getMinimumBuffer(userId: string): Promise<number> {
  const insights = await prisma.schedulingInsights.findUnique({
    where: { userId },
    select: { avgBufferMin: true },
  });
  return insights?.avgBufferMin ?? 15;
}
```

Update the constructor or initialization of `TimeSlotManager` to accept and use these values.

### Step 5: Trigger insight updates periodically

**File:** `src/server/features/calendar/sync/google.ts` (or the sync entry point)

After a successful calendar sync, trigger insight updates:

```typescript
// At the end of syncGoogleCalendarChanges():
if (changed) {
  // Fire and forget -- don't block sync
  updateSchedulingInsights(userId).catch(() => {});
}
```

---

## Files to Modify

- `prisma/schema.prisma` -- add `SchedulingInsights` model
- `src/server/features/calendar/scheduling/TimeSlotManager.ts` -- use insights instead of hardcoded values
- `src/server/features/calendar/sync/google.ts` -- trigger insight updates on sync

## Files to Create

- `prisma/migrations/<timestamp>_add_scheduling_insights/migration.sql` (auto-generated)
- `src/server/features/calendar/scheduling/insights.ts` -- learning function

## Testing Instructions

1. Apply migration: `bunx prisma migrate dev`
2. Verify TypeScript compiles: `bunx tsc --noEmit`
3. Run scheduling tests: `bunx vitest run src/server/features/calendar/scheduling/`
4. Create test calendar events with varied durations and verify insights update

## Rollback Plan

Drop the `SchedulingInsights` table and revert to hardcoded values.

## Dependencies on Other Issues

- **Issue 20** (learn work hour defaults): Closely related -- insights feed into work hour adjustments.
