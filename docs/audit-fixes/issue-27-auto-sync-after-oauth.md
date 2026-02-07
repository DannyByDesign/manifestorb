# Issue 27: Auto-Discover and Sync All Services After OAuth

**Severity:** MEDIUM
**Category:** Integration Architecture

---

## Problem

Email watching, calendar sync, and drive sync each require separate explicit setup:

1. **Email** (`src/server/features/email/watch-manager.ts`): `ensureEmailAccountsWatched()` must be called to set up Gmail/Outlook push notifications. This is triggered by a scheduled job or API call.
2. **Calendar** (`src/server/features/calendar/sync/google.ts`): `syncGoogleCalendarChanges()` must be triggered per-calendar with a sync token.
3. **Drive** (`src/server/features/drive/sync/google.ts`): `syncGoogleDriveChanges()` must be triggered per-connection with a page token.

After OAuth, the user must navigate to separate pages to "connect" each service. There is no automatic discovery of what services are available and no automatic setup of all syncs.

---

## Root Cause

Each integration was built independently. The OAuth callback only creates the `Account` record; it doesn't trigger downstream sync setup for all available services.

---

## Step-by-Step Fix

### Step 1: Create a post-OAuth orchestrator

**File:** `src/server/features/integrations/post-oauth.ts` (NEW FILE)

```typescript
import { createScopedLogger } from "@/server/lib/logger";
import prisma from "@/server/db/client";

const logger = createScopedLogger("post-oauth");

/**
 * After a successful OAuth flow, automatically discover and set up
 * all available services for the connected account.
 */
export async function setupIntegrationsAfterOAuth({
  accountId,
  userId,
  provider,
}: {
  accountId: string;
  userId: string;
  provider: string; // "google" | "microsoft"
}): Promise<{ services: string[]; errors: string[] }> {
  const services: string[] = [];
  const errors: string[] = [];

  // 1. Email (Gmail/Outlook) -- always set up
  try {
    const emailAccount = await prisma.emailAccount.findFirst({
      where: { accountId },
    });
    if (emailAccount) {
      const { watchEmailAccount } = await import("@/features/email/watch-manager");
      await watchEmailAccount(emailAccount.id);
      services.push("email");
      logger.info("Email watching set up", { emailAccountId: emailAccount.id });
    }
  } catch (error) {
    logger.error("Failed to set up email watching", { error });
    errors.push("email");
  }

  // 2. Calendar -- check if calendar scopes are available
  try {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { scope: true },
    });
    const hasCalendarScope = account?.scope?.includes("calendar") ?? false;

    if (hasCalendarScope) {
      // Create or find CalendarConnection
      let calendarConnection = await prisma.calendarConnection.findFirst({
        where: { userId, provider },
      });

      if (!calendarConnection) {
        calendarConnection = await prisma.calendarConnection.create({
          data: {
            userId,
            provider,
            accountId,
            // Additional fields as needed by your schema
          },
        });
      }

      // Trigger initial sync
      if (provider === "google") {
        const { syncGoogleCalendarChanges } = await import("@/features/calendar/sync/google");
        // Fetch calendars and sync each one
        // Implementation depends on how calendars are listed in your schema
      }

      services.push("calendar");
      logger.info("Calendar sync set up", { userId });
    }
  } catch (error) {
    logger.error("Failed to set up calendar sync", { error });
    errors.push("calendar");
  }

  // 3. Drive -- check if drive scopes are available
  try {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { scope: true },
    });
    const hasDriveScope = account?.scope?.includes("drive") ?? false;

    if (hasDriveScope) {
      let driveConnection = await prisma.driveConnection.findFirst({
        where: { userId, provider },
      });

      if (!driveConnection) {
        driveConnection = await prisma.driveConnection.create({
          data: {
            userId,
            provider,
            accountId,
          },
        });
      }

      services.push("drive");
      logger.info("Drive connection set up", { userId });
    }
  } catch (error) {
    logger.error("Failed to set up drive connection", { error });
    errors.push("drive");
  }

  // 4. Notify user of what was set up
  if (services.length > 0) {
    const { createInAppNotification } = await import("@/features/notifications/create");
    await createInAppNotification({
      userId,
      title: "Account connected",
      body: `I've set up ${services.join(", ")} for you. ${errors.length > 0 ? `Note: ${errors.join(", ")} failed to connect.` : "Everything is ready."}`,
      type: "info",
      dedupeKey: `oauth-setup-${accountId}`,
    });
  }

  return { services, errors };
}
```

### Step 2: Call the orchestrator from OAuth callbacks

Find the Google OAuth callback handler. It will be in one of:
- `src/app/api/google/linking/callback/route.ts`
- `src/app/api/auth/callback/google/route.ts`
- Or similar

After the account is created/updated, add:

```typescript
import { setupIntegrationsAfterOAuth } from "@/features/integrations/post-oauth";

// After successful OAuth:
// Fire and forget -- don't block the callback redirect
setupIntegrationsAfterOAuth({
  accountId: account.id,
  userId: session.user.id,
  provider: "google",
}).catch(err => {
  logger.error("Post-OAuth setup failed", { error: err });
});
```

### Step 3: Handle re-authorization (scope upgrades)

When a user adds new scopes (e.g., adds Calendar to an existing Gmail-only connection), the same orchestrator should run. Check if the existing account's scopes have changed:

```typescript
// In the OAuth callback, before calling setupIntegrationsAfterOAuth:
const existingAccount = await prisma.account.findUnique({ where: { id: accountId } });
const oldScopes = new Set((existingAccount?.scope ?? "").split(" "));
const newScopes = new Set(tokenResponse.scope.split(" "));
const addedScopes = [...newScopes].filter(s => !oldScopes.has(s));

if (addedScopes.length > 0) {
  // New scopes detected -- re-run integration setup
  await setupIntegrationsAfterOAuth({ accountId, userId, provider: "google" });
}
```

---

## Files to Modify

- OAuth callback route(s) -- call `setupIntegrationsAfterOAuth` after account creation

## Files to Create

- `src/server/features/integrations/post-oauth.ts` -- post-OAuth orchestrator

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Disconnect and reconnect a Google account
3. Verify email watching is automatically set up (check `watchEmailsExpirationDate` in database)
4. If calendar scopes are present, verify calendar sync starts
5. Verify the user receives a notification about what was set up

## Rollback Plan

Delete `post-oauth.ts` and remove the call from the OAuth callback. Users will need to manually connect services as before.

## Dependencies on Other Issues

- None directly. This is an independent integration improvement.
