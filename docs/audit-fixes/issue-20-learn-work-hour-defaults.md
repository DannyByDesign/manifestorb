# Issue 20: Auto-Adjust Work Hour Defaults from Calendar Patterns

**Severity:** LOW
**Category:** Hardcoded Business Logic

---

## Problem

The `TaskPreference` model in `prisma/schema.prisma` (lines 1072-1075) has hardcoded defaults:

```prisma
workHourStart       Int      @default(9)
workHourEnd         Int      @default(17)
workDays            Int[]    @default([1, 2, 3, 4, 5])
bufferMinutes       Int      @default(15)
```

These defaults are standard 9-5 but don't match many users' actual schedules. A user who regularly works 8am-7pm will get suboptimal scheduling suggestions.

---

## Root Cause

Defaults are fine for onboarding, but no mechanism exists to update them based on actual behavior.

---

## Step-by-Step Fix

### Step 1: Use SchedulingInsights to suggest preference updates

This builds on **Issue 19** which creates the `SchedulingInsights` model and the `updateSchedulingInsights()` function.

**File:** `src/server/features/calendar/scheduling/insights.ts`

Add a function that compares insights to current preferences and suggests updates:

```typescript
/**
 * Check if the user's actual work patterns differ significantly
 * from their TaskPreference settings. If so, create a suggestion notification.
 */
export async function suggestPreferenceUpdates(userId: string): Promise<void> {
  const [insights, preferences] = await Promise.all([
    prisma.schedulingInsights.findUnique({ where: { userId } }),
    prisma.taskPreference.findUnique({ where: { userId } }),
  ]);

  if (!insights || !preferences) return;
  if (!insights.actualWorkHourStart || !insights.actualWorkHourEnd) return;

  const diffs: string[] = [];

  // Check if actual work hours differ by more than 1 hour
  if (insights.actualWorkHourStart < preferences.workHourStart - 1) {
    diffs.push(`You often start as early as ${formatHour(insights.actualWorkHourStart)}, but your settings say ${formatHour(preferences.workHourStart)}.`);
  }
  if (insights.actualWorkHourEnd > preferences.workHourEnd + 1) {
    diffs.push(`You often work until ${formatHour(insights.actualWorkHourEnd)}, but your settings say ${formatHour(preferences.workHourEnd)}.`);
  }

  // Check work days
  if (insights.activeWorkDays.length > 0) {
    const insightDays = new Set(insights.activeWorkDays);
    const prefDays = new Set(preferences.workDays);
    const extraDays = insights.activeWorkDays.filter(d => !prefDays.has(d));
    if (extraDays.length > 0) {
      const dayNames = extraDays.map(d => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]);
      diffs.push(`You also have meetings on ${dayNames.join(", ")}, which aren't in your work days.`);
    }
  }

  if (diffs.length === 0) return;

  // Create a conversational notification suggesting updates
  const { createInAppNotification } = await import("@/features/notifications/create");
  await createInAppNotification({
    userId,
    title: "Your schedule settings might be outdated",
    body: `Based on your recent calendar:\n${diffs.join("\n")}\n\nWant me to update your settings?`,
    type: "info",
    dedupeKey: `schedule-suggestion-${userId}-${new Date().toISOString().slice(0, 10)}`,
    metadata: {
      type: "preference_suggestion",
      suggestions: {
        workHourStart: Math.floor(insights.actualWorkHourStart),
        workHourEnd: Math.ceil(insights.actualWorkHourEnd),
        workDays: insights.activeWorkDays,
        bufferMinutes: insights.avgBufferMin ? Math.round(insights.avgBufferMin) : preferences.bufferMinutes,
      },
    },
  });
}

function formatHour(h: number): string {
  const hour = Math.floor(h);
  const minutes = Math.round((h - hour) * 60);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return minutes > 0 ? `${h12}:${String(minutes).padStart(2, "0")} ${ampm}` : `${h12} ${ampm}`;
}
```

### Step 2: Trigger suggestions after insight updates

**File:** `src/server/features/calendar/scheduling/insights.ts`

At the end of `updateSchedulingInsights()`, call the suggestion function:

```typescript
// At the end of updateSchedulingInsights():
await suggestPreferenceUpdates(userId);
```

### Step 3: Let the AI apply suggested changes

When the user responds to the suggestion ("yes, update my settings"), the AI should use the `modify(preferences)` tool (from Issue 08) to apply the changes. The suggestion metadata contains the exact values.

No additional code is needed for this -- the AI will read the notification content and know what to update.

---

## Files to Modify

- `src/server/features/calendar/scheduling/insights.ts` -- add suggestion function, call from insights update

## Files to Create

None (extends Issue 19's new file).

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Create a TaskPreference with 9-5 defaults
3. Create calendar events outside those hours (e.g., 8am and 6:30pm meetings)
4. Run `updateSchedulingInsights()` and verify a suggestion notification is created
5. Verify the notification suggests updated hours

## Rollback Plan

Remove the `suggestPreferenceUpdates` function and its call site.

## Dependencies on Other Issues

- **Issue 19** (adaptive scheduling): This issue extends Issue 19's insights system.
- **Issue 08** (settings via AI): The AI applies suggested changes via the modify tool.
