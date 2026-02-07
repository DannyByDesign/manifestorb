# Issue 08: Enable Settings Changes via AI Conversation

**Severity:** MEDIUM
**Category:** Dashboard/UI-Centric Architecture

---

## Problem

Settings actions in `src/server/actions/settings.ts` (`updateEmailSettingsAction`, `updateDigestScheduleAction`, `toggleDigestAction`) use Zod schemas from `src/server/actions/settings.validation.ts` that expect structured form data:

```typescript
// settings.validation.ts
export const saveDigestScheduleBody = z.object({
  intervalDays: z.number().nullable(),
  daysOfWeek: z.number().nullable(),
  timeOfDay: z.coerce.date().nullable(),
  occurrences: z.number().nullable(),
});

export const toggleDigestBody = z.object({
  enabled: z.boolean(),
  timeOfDay: z.coerce.date().optional(),
});
```

Users cannot say "send me a daily digest at 9am" to the AI -- they must navigate to a settings page and fill out a form.

---

## Root Cause

Settings were built as form-backed CRUD operations. No AI tool exposes settings modification.

---

## Step-by-Step Fix

### Step 1: Add `preferences` resource to the `modify` tool

**File:** `src/server/features/ai/tools/modify.ts`

The modify tool already has `"preferences"` in its resource enum (line 45). Check if there is an existing handler for it. If there is a partial implementation, extend it. If not, add one.

Find the `execute` function's switch statement. Add or update the `preferences` case:

```typescript
case "preferences": {
  const { changes } = args;
  const userId = context.userId;

  // Digest settings
  if ("digestEnabled" in changes) {
    const { toggleDigestAction } = await import("@/server/actions/settings");
    await toggleDigestAction({
      enabled: Boolean(changes.digestEnabled),
      timeOfDay: changes.digestTime ? new Date(changes.digestTime as string) : undefined,
    });
    return { success: true, message: `Digest ${changes.digestEnabled ? "enabled" : "disabled"}.` };
  }

  // Digest schedule
  if ("digestSchedule" in changes) {
    const schedule = changes.digestSchedule as Record<string, unknown>;
    const { updateDigestScheduleAction } = await import("@/server/actions/settings");
    await updateDigestScheduleAction({
      intervalDays: (schedule.intervalDays as number) ?? null,
      daysOfWeek: (schedule.daysOfWeek as number) ?? null,
      timeOfDay: schedule.timeOfDay ? new Date(schedule.timeOfDay as string) : null,
      occurrences: (schedule.occurrences as number) ?? null,
    });
    return { success: true, message: "Digest schedule updated." };
  }

  // Email notification frequency
  if ("statsEmailFrequency" in changes || "summaryEmailFrequency" in changes) {
    const { updateEmailSettingsAction } = await import("@/server/actions/settings");
    await updateEmailSettingsAction({
      statsEmailFrequency: (changes.statsEmailFrequency as string) ?? "NEVER",
      summaryEmailFrequency: (changes.summaryEmailFrequency as string) ?? "NEVER",
    });
    return { success: true, message: "Email notification settings updated." };
  }

  return { success: false, error: "Unknown preference key. Supported: digestEnabled, digestSchedule, statsEmailFrequency, summaryEmailFrequency." };
}
```

### Step 2: Add `preferences` resource to the `query` tool for reading current settings

**File:** `src/server/features/ai/tools/query.ts`

Add a `preferences` case to the query tool's execute switch:

```typescript
case "preferences": {
  const emailAccount = await prisma.emailAccount.findFirst({
    where: { userId: context.userId },
    select: {
      about: true,
      statsEmailFrequency: true,
      summaryEmailFrequency: true,
    },
  });
  const taskPreference = await prisma.taskPreference.findUnique({
    where: { userId: context.userId },
    select: {
      workHourStart: true,
      workHourEnd: true,
      workDays: true,
      bufferMinutes: true,
      timeZone: true,
    },
  });
  return {
    success: true,
    data: {
      email: emailAccount,
      scheduling: taskPreference,
    },
    message: "Current preferences loaded.",
  };
}
```

Also add `"preferences"` to the resource enum in the query parameters.

### Step 3: Update tool descriptions

**File:** `src/server/features/ai/tools/modify.ts`

Add to the description string:

```
Preferences changes:
- digestEnabled: boolean (enable/disable daily digest)
- digestTime: ISO date string (time of day for digest, e.g. "2026-01-01T09:00:00")
- digestSchedule: { intervalDays, daysOfWeek, timeOfDay, occurrences }
- statsEmailFrequency: "WEEKLY" | "NEVER"
- summaryEmailFrequency: "WEEKLY" | "NEVER"
```

### Step 4: Update system prompt to mention preferences

**File:** `src/server/features/ai/system-prompt.ts`

Add a section to the system prompt:

```typescript
## Preferences
When the user asks to change settings like "send me a daily digest at 9am" or "turn off email summaries", use the modify tool with resource "preferences". Query current preferences first if unsure of current values.
```

---

## Files to Modify

- `src/server/features/ai/tools/modify.ts` -- add/extend `preferences` handler
- `src/server/features/ai/tools/query.ts` -- add `preferences` resource
- `src/server/features/ai/system-prompt.ts` -- add preferences guidance

## Files to Create

None.

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Test via AI chat: "send me a daily digest at 9am", "turn off my email summaries"
3. Verify the settings are actually changed by querying the database after the AI modifies them

## Rollback Plan

Revert the modified files via git. The existing form-based settings UI continues to work regardless.

## Dependencies on Other Issues

- **Issue 21** (configurable system prompt): Related -- both deal with user preferences. But this issue is about exposing existing settings via AI, while Issue 21 is about making prompt constraints configurable.
