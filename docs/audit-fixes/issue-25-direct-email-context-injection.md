# Issue 25: Query EmailMessage Directly for Thread Context

**Severity:** MEDIUM
**Category:** Context & Memory

---

## Problem

In `src/server/features/channels/executor.ts` (lines 145-171), when the user is replying in the context of an email thread (e.g., from a notification), the executor looks up `InAppNotification` records to inject context:

```typescript
let threadContextBlock = "";
if (context.messageId || context.threadId) {
  const recent = await prisma.inAppNotification.findMany({
    where: {
      userId: user.id,
      dedupeKey: { startsWith: "email-rule-" },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { title: true, body: true, metadata: true },
  });
  const meta = context.messageId
    ? recent.find((r) => (r.metadata as { messageId?: string })?.messageId === context.messageId)
    : context.threadId
      ? recent.find((r) => (r.metadata as { threadId?: string })?.threadId === context.threadId)
      : recent[0];
```

Problems:
1. If no `InAppNotification` was created for the email (e.g., user is asking about an old email that didn't trigger a rule), **no context is injected**
2. The context comes from the notification's title/body, which is a summary -- not the actual email content
3. Only notifications with `dedupeKey` starting with `"email-rule-"` are searched, missing other types

---

## Root Cause

Thread context was built on top of the notification system rather than querying email data directly.

---

## Step-by-Step Fix

### Step 1: Create a thread context helper

**File:** `src/server/features/ai/thread-context.ts` (NEW FILE)

```typescript
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";

export interface ThreadContext {
  subject: string;
  from: string;
  to: string;
  snippet: string;
  receivedAt: Date;
  threadId?: string;
  messageId?: string;
}

/**
 * Fetch email context for a given messageId or threadId.
 * Tries direct email lookup first, falls back to notification metadata.
 */
export async function getThreadContext({
  userId,
  messageId,
  threadId,
  logger,
}: {
  userId: string;
  messageId?: string;
  threadId?: string;
  logger: Logger;
}): Promise<string> {
  if (!messageId && !threadId) return "";

  // 1. Try to find the actual email message
  let emailContext: ThreadContext | null = null;

  if (messageId) {
    // Look up by messageId in EmailMessage or similar table
    // NOTE: Check actual model name -- may be EmailMessage, GmailMessage, etc.
    const message = await prisma.emailMessage.findFirst({
      where: {
        OR: [
          { id: messageId },
          { messageId: messageId }, // Gmail message ID
        ],
        emailAccount: { userId },
      },
      select: {
        subject: true,
        fromAddress: true,
        toAddress: true,
        snippet: true,
        receivedAt: true,
        threadId: true,
        messageId: true,
      },
    }).catch(() => null);

    if (message) {
      emailContext = {
        subject: message.subject || "(No subject)",
        from: message.fromAddress || "",
        to: message.toAddress || "",
        snippet: message.snippet || "",
        receivedAt: message.receivedAt,
        threadId: message.threadId ?? undefined,
        messageId: message.messageId ?? undefined,
      };
    }
  }

  if (!emailContext && threadId) {
    // Look up latest message in thread
    const message = await prisma.emailMessage.findFirst({
      where: {
        threadId,
        emailAccount: { userId },
      },
      orderBy: { receivedAt: "desc" },
      select: {
        subject: true,
        fromAddress: true,
        toAddress: true,
        snippet: true,
        receivedAt: true,
        threadId: true,
        messageId: true,
      },
    }).catch(() => null);

    if (message) {
      emailContext = {
        subject: message.subject || "(No subject)",
        from: message.fromAddress || "",
        to: message.toAddress || "",
        snippet: message.snippet || "",
        receivedAt: message.receivedAt,
        threadId: message.threadId ?? undefined,
        messageId: message.messageId ?? undefined,
      };
    }
  }

  // 2. Fallback: try notification metadata (existing behavior)
  if (!emailContext) {
    const recent = await prisma.inAppNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { title: true, body: true, metadata: true },
    });

    const meta = messageId
      ? recent.find((r) => (r.metadata as Record<string, unknown>)?.messageId === messageId)
      : threadId
        ? recent.find((r) => (r.metadata as Record<string, unknown>)?.threadId === threadId)
        : null;

    if (meta) {
      return `
---
## Current context (from notification)
**${meta.title}**: ${meta.body || ""}
When the user says "them", "the sender", or "this person", they mean the sender of this email.
---
`;
    }

    return "";
  }

  // 3. Build rich context block from actual email data
  return `
---
## Current context (email thread)
**Subject:** ${emailContext.subject}
**From:** ${emailContext.from}
**To:** ${emailContext.to}
**Received:** ${emailContext.receivedAt.toLocaleString()}
**Preview:** ${emailContext.snippet.substring(0, 500)}

When the user says "them", "the sender", or "this person", they mean **${emailContext.from}**. Use this email's data for context when responding to user requests about this email.
---
`;
}
```

**Important:** The model name `emailMessage` in the Prisma queries above may need adjustment. Search the schema for the actual email storage model:

```bash
rg "model.*Email.*Message" prisma/schema.prisma
rg "model.*Gmail" prisma/schema.prisma
```

Adjust field names (`fromAddress`, `toAddress`, `snippet`, `receivedAt`, `messageId`, `threadId`) to match actual column names.

### Step 2: Replace the notification-based lookup in executor.ts

**File:** `src/server/features/channels/executor.ts`

Remove lines 145-171 (the `threadContextBlock` logic). Replace with:

```typescript
import { getThreadContext } from "@/features/ai/thread-context";

const threadContextBlock = await getThreadContext({
  userId: user.id,
  messageId: context.messageId,
  threadId: context.threadId,
  logger,
});
```

### Step 3: Use the same helper in chat.ts (if applicable)

If `chat.ts` doesn't currently have thread context injection (it doesn't -- see the audit), add it:

**File:** `src/server/features/web-chat/ai/chat.ts`

If the web chat supports message/thread context (e.g., from a notification click), add the same call.

---

## Files to Modify

- `src/server/features/channels/executor.ts` -- replace notification-based lookup with direct email query

## Files to Create

- `src/server/features/ai/thread-context.ts` -- thread context helper

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Find an email messageId in the database that does NOT have a corresponding notification
3. Trigger a surface message with that messageId as context
4. Verify the AI receives the email's subject, sender, and snippet as context
5. Test the fallback: use a messageId that doesn't exist in EmailMessage -- should fall back to notification lookup
6. Run tests: `bunx vitest run`

## Rollback Plan

Delete `thread-context.ts` and restore the original notification-based logic in `executor.ts`.

## Dependencies on Other Issues

- **Issue 17** (unify pipelines): Thread context should be injected once in the unified pipeline.
- **Issue 12** (enrich context pack): Related but different -- Issue 12 adds broad domain awareness; this issue fixes specific thread context.
