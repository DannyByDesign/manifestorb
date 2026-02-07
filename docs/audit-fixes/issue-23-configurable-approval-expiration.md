# Issue 23: Make Approval Expiration Configurable

**Severity:** LOW
**Category:** Hardcoded Business Logic

---

## Problem

Approval expiration is hardcoded to 3600 seconds (1 hour) in three places:

1. **`src/server/features/channels/executor.ts`** (line 103):
   ```typescript
   expiresInSeconds: 3600
   ```

2. **`src/server/features/web-chat/ai/chat.ts`** (line 257):
   ```typescript
   expiresInSeconds: 3600
   ```

3. **`src/server/features/approvals/service.ts`** (line 8):
   ```typescript
   const DEFAULT_EXPIRY_SECONDS = 3600; // 1 hour
   ```

A 1-hour expiry means approvals created before lunch expire before the user returns. Users in different timezones or with different response patterns need different expiry windows.

---

## Root Cause

A single default was chosen during implementation. The `ApprovalService.createRequest()` method accepts `expiresInSeconds` as a parameter, so the infrastructure for per-request expiry already exists -- callers just hardcode it.

---

## Step-by-Step Fix

### Step 1: Add expiry preference to UserAIConfig (or TaskPreference)

If Issue 21's `UserAIConfig` model exists, add there:

**File:** `prisma/schema.prisma`

```prisma
model UserAIConfig {
  // ... existing fields from Issue 21 ...
  defaultApprovalExpirySeconds Int? // null = use DEFAULT_EXPIRY_SECONDS (3600)
}
```

Or if `UserAIConfig` doesn't exist yet, add to `TaskPreference`:

```prisma
model TaskPreference {
  // ... existing fields ...
  approvalExpirySeconds Int @default(3600)
}
```

### Step 2: Create the migration

```bash
bunx prisma migrate dev --name add_approval_expiry_preference
```

### Step 3: Create a helper to get the expiry

**File:** `src/server/features/approvals/service.ts`

Add a static method or module-level function:

```typescript
const DEFAULT_EXPIRY_SECONDS = 3600;

export async function getApprovalExpiry(userId: string): Promise<number> {
  const config = await prisma.userAIConfig.findUnique({
    where: { userId },
    select: { defaultApprovalExpirySeconds: true },
  });
  return config?.defaultApprovalExpirySeconds ?? DEFAULT_EXPIRY_SECONDS;
}
```

### Step 4: Update `executor.ts` to use the helper

**File:** `src/server/features/channels/executor.ts`

Find line 103 where `expiresInSeconds: 3600` is hardcoded. Replace:

```typescript
// Before:
expiresInSeconds: 3600

// After:
import { getApprovalExpiry } from "@/features/approvals/service";
// ... earlier in the function:
const expirySeconds = await getApprovalExpiry(user.id);
// ... in the createRequest call:
expiresInSeconds: expirySeconds
```

### Step 5: Update `chat.ts` to use the helper

**File:** `src/server/features/web-chat/ai/chat.ts`

Same change as Step 4. Find line 257:

```typescript
// Before:
expiresInSeconds: 3600

// After:
const expirySeconds = await getApprovalExpiry(user.id);
// ... in the createRequest call:
expiresInSeconds: expirySeconds
```

### Step 6: Update SCHEDULE_MEETING action

**File:** `src/server/features/ai/actions.ts`

In the `schedule_meeting` function, replace:

```typescript
// Before:
expiresInSeconds: SCHEDULE_MEETING_EXPIRY_SECONDS,

// After (if Issue 22 is also implemented):
expiresInSeconds: expirySeconds, // from user preferences
```

---

## Files to Modify

- `prisma/schema.prisma` -- add `defaultApprovalExpirySeconds` field
- `src/server/features/approvals/service.ts` -- add `getApprovalExpiry` helper
- `src/server/features/channels/executor.ts` -- use helper instead of hardcoded value
- `src/server/features/web-chat/ai/chat.ts` -- use helper instead of hardcoded value
- `src/server/features/ai/actions.ts` -- use helper for SCHEDULE_MEETING expiry

## Files to Create

- `prisma/migrations/<timestamp>_add_approval_expiry_preference/migration.sql` (auto-generated)

## Testing Instructions

1. Apply migration: `bunx prisma migrate dev`
2. Verify TypeScript compiles: `bunx tsc --noEmit`
3. Set `defaultApprovalExpirySeconds: 86400` (24h) for a test user
4. Create an approval and verify `expiresAt` is 24 hours in the future
5. Verify default (no config row) still uses 3600 seconds

## Rollback Plan

Drop the new column and revert to hardcoded 3600.

## Dependencies on Other Issues

- **Issue 21** (configurable system prompt): Uses the same `UserAIConfig` model.
- **Issue 22** (configurable SCHEDULE_MEETING): SCHEDULE_MEETING expiry is a special case of this.
- **Issue 17** (unify pipelines): After unification, only one place needs the helper call.
