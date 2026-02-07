# Issue 14: Replace emailAccounts[0] Pattern with userId-Based Lookups

**Severity:** MEDIUM
**Category:** Feature Siloing

---

## Problem

Multiple code paths assume a single email account per user by using `user.emailAccounts[0]`:

1. `src/server/features/channels/executor.ts` (line 44): `emailAccount` is passed in but internally many sub-calls assume it's the only one.
2. `src/server/features/calendar/schedule-proposal.ts` (line 101): Uses `user.emailAccounts[0]` to get the email provider for draft operations.

Multi-account users would have a fragmented experience -- knowledge, context, and actions would only apply to whichever account happens to be `[0]`.

---

## Root Cause

The codebase was initially built for single-account users. When multi-account support was partially added, many code paths took the shortcut of `emailAccounts[0]`.

---

## Step-by-Step Fix

### Step 1: Find all instances of the pattern

Search the codebase:

```bash
rg "emailAccounts\[0\]" --type ts
```

This will return all files using the pattern. Common locations include:
- `src/server/features/channels/executor.ts`
- `src/server/features/calendar/schedule-proposal.ts`
- Possibly other files in `src/server/features/`

### Step 2: Fix `schedule-proposal.ts`

**File:** `src/server/features/calendar/schedule-proposal.ts`

Find line 101 (or nearby) where `user.emailAccounts[0]` is used:

```typescript
// Before:
const emailAccount = user.emailAccounts[0];
```

Replace with a lookup that uses the `emailAccountId` from the approval request payload:

```typescript
// After:
const emailAccountId = (payload as { emailAccountId?: string }).emailAccountId;
if (!emailAccountId) {
  logger.warn("No emailAccountId in schedule proposal payload");
  // Fallback to first account
  const emailAccount = user.emailAccounts[0];
  // ... continue with fallback
} else {
  const emailAccount = user.emailAccounts.find(ea => ea.id === emailAccountId)
    ?? user.emailAccounts[0]; // Fallback if not found
  // ... continue with resolved account
}
```

The SCHEDULE_MEETING action in `actions.ts` already stores `emailAccountId` in the payload, so this field should be available.

### Step 3: Fix `executor.ts`

**File:** `src/server/features/channels/executor.ts`

The executor already receives `emailAccount` as a parameter (line 23). Verify that all internal calls use this specific account rather than re-fetching `user.emailAccounts[0]`.

Search within the file for any `emailAccounts[0]` usage:

```bash
rg "emailAccounts\[0\]" src/server/features/channels/executor.ts
```

If found, replace with the `emailAccount` parameter.

### Step 4: Create a helper function for email account resolution

**File:** `src/server/lib/user-utils.ts` (NEW or add to existing utility file)

Create a reusable helper:

```typescript
import type { EmailAccount, User } from "@/generated/prisma/client";

/**
 * Resolve the best email account for a given context.
 * Priority: explicit emailAccountId > primary account > first account.
 */
export function resolveEmailAccount(
  user: { emailAccounts: EmailAccount[] },
  preferredEmailAccountId?: string | null,
): EmailAccount | null {
  if (!user.emailAccounts.length) return null;

  if (preferredEmailAccountId) {
    const match = user.emailAccounts.find(ea => ea.id === preferredEmailAccountId);
    if (match) return match;
  }

  // TODO: When a "primary" flag is added to EmailAccount, use it here
  return user.emailAccounts[0];
}
```

### Step 5: Replace all `emailAccounts[0]` with the helper

For each file found in Step 1:

```typescript
// Before:
const emailAccount = user.emailAccounts[0];

// After:
import { resolveEmailAccount } from "@/server/lib/user-utils";
const emailAccount = resolveEmailAccount(user, contextEmailAccountId);
if (!emailAccount) {
  throw new Error("No email account available for user");
}
```

Where `contextEmailAccountId` comes from the relevant context (approval payload, API request, etc.).

### Step 6: Add a `primaryEmailAccountId` to User (optional, future)

**File:** `prisma/schema.prisma`

For a future improvement, add:

```prisma
model User {
  // ... existing fields ...
  primaryEmailAccountId String?
}
```

This allows users to set a default account. The `resolveEmailAccount` helper can then check this field.

---

## Files to Modify

- `src/server/features/calendar/schedule-proposal.ts` -- use emailAccountId from payload
- `src/server/features/channels/executor.ts` -- verify no emailAccounts[0] usage
- All other files found by `rg "emailAccounts\[0\]"` -- replace with helper
- `src/server/lib/user-utils.ts` -- create or extend with helper function

## Files to Create

- `src/server/lib/user-utils.ts` (if not existing) -- email account resolution helper

## Testing Instructions

1. Search for remaining instances: `rg "emailAccounts\[0\]" --type ts` should return 0 results
2. Verify TypeScript compiles: `bunx tsc --noEmit`
3. Run tests: `bunx vitest run`
4. Test the schedule proposal flow with the E2E test

## Rollback Plan

Revert all modified files. The `emailAccounts[0]` pattern is a working fallback.

## Dependencies on Other Issues

- **Issue 11** (knowledge per user): Both address the same root cause of per-email-account scoping.
