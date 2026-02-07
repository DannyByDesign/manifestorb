# Issue 28: Add Cross-Integration Awareness Between Features

**Severity:** MEDIUM
**Category:** Integration Architecture

---

## Problem

Each integration operates independently with no awareness of the others:

- **Email processing** doesn't check calendar availability when an email mentions a meeting
- **Task creation** from email doesn't check calendar conflicts
- **Drive filing** doesn't create follow-up tasks
- **Calendar event creation** doesn't check for related unread emails from attendees

The features exist in silos. A human executive assistant would naturally cross-reference: "Sarah wants to meet next week -- let me check your calendar and also pull up her last few emails."

---

## Root Cause

Each feature was imported from a separate open-source project or built independently. No cross-feature awareness layer exists.

---

## Step-by-Step Fix

### Step 1: Create a cross-reference service

**File:** `src/server/features/ai/cross-reference.ts` (NEW FILE)

```typescript
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";

export interface CrossReferenceContext {
  relatedEmails?: Array<{
    threadId: string;
    subject: string;
    from: string;
    receivedAt: Date;
  }>;
  calendarConflicts?: Array<{
    title: string;
    start: Date;
    end: Date;
  }>;
  relatedTasks?: Array<{
    id: string;
    title: string;
    status: string;
    dueDate?: Date;
  }>;
  relatedFilings?: Array<{
    filename: string;
    folderPath: string;
  }>;
}

/**
 * Given a set of entity references, find related items across features.
 * Call this when processing emails, creating events, or filing documents
 * to enrich the AI's context.
 */
export async function findCrossReferences({
  userId,
  emailAddress,
  subject,
  attendees,
  logger,
}: {
  userId: string;
  emailAddress?: string;   // Sender or attendee email
  subject?: string;        // Email subject or event title
  attendees?: string[];    // Calendar event attendees
  logger: Logger;
}): Promise<CrossReferenceContext> {
  const context: CrossReferenceContext = {};

  // 1. Find related emails by sender
  if (emailAddress) {
    try {
      // NOTE: Adjust model/field names to match actual schema
      const emails = await prisma.$queryRaw<
        Array<{ threadId: string; subject: string; fromAddress: string; receivedAt: Date }>
      >`
        SELECT DISTINCT ON (t."threadId") t."threadId", t.subject, t."fromAddress", t."receivedAt"
        FROM "EmailThread" t
        JOIN "EmailAccount" ea ON t."emailAccountId" = ea.id
        WHERE ea."userId" = ${userId}
          AND t."fromAddress" ILIKE ${`%${emailAddress}%`}
          AND t."receivedAt" > ${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)}
        ORDER BY t."threadId", t."receivedAt" DESC
        LIMIT 5
      `;
      context.relatedEmails = emails.map(e => ({
        threadId: e.threadId,
        subject: e.subject,
        from: e.fromAddress,
        receivedAt: e.receivedAt,
      }));
    } catch (error) {
      logger.warn("Cross-ref: failed to find related emails", { error });
    }
  }

  // 2. Find calendar conflicts for attendees
  if (attendees?.length) {
    try {
      // Check if any attendees have upcoming events
      // This would use the calendar provider API
      // For now, check CalendarActionLog for recent events with same attendees
      // NOTE: This is a simplified version -- real implementation needs calendar API
      context.calendarConflicts = [];
    } catch (error) {
      logger.warn("Cross-ref: failed to check calendar conflicts", { error });
    }
  }

  // 3. Find related tasks by subject keywords
  if (subject) {
    try {
      const keywords = subject
        .split(/\s+/)
        .filter(w => w.length > 3)
        .slice(0, 5);

      if (keywords.length > 0) {
        const tasks = await prisma.task.findMany({
          where: {
            userId,
            status: { in: ["PENDING", "IN_PROGRESS"] },
            OR: keywords.map(kw => ({
              title: { contains: kw, mode: "insensitive" as const },
            })),
          },
          select: { id: true, title: true, status: true, dueDate: true },
          take: 3,
        });
        context.relatedTasks = tasks;
      }
    } catch (error) {
      logger.warn("Cross-ref: failed to find related tasks", { error });
    }
  }

  // 4. Find related drive filings by sender email
  if (emailAddress) {
    try {
      // NOTE: Adjust to match actual schema -- filings may be linked via messageId
      const filings = await prisma.documentFiling.findMany({
        where: {
          emailAccount: { userId },
          // Search for filings from emails by this sender
          // This requires cross-feature FK from Issue 10
        },
        select: { filename: true, folderPath: true },
        take: 3,
      });
      context.relatedFilings = filings;
    } catch (error) {
      logger.warn("Cross-ref: failed to find related filings", { error });
    }
  }

  return context;
}
```

### Step 2: Integrate cross-references into email rule processing

**File:** `src/server/features/rules/ai/run-rules.ts`

After matching rules and before executing actions, fetch cross-references:

```typescript
import { findCrossReferences } from "@/features/ai/cross-reference";

// Inside executeMatchedRule or similar:
const crossRef = await findCrossReferences({
  userId: emailAccount.userId,
  emailAddress: message.headers.from,
  subject: message.headers.subject,
  logger,
});

// Include cross-references in the action context
// so SCHEDULE_MEETING knows about related emails/tasks
```

### Step 3: Integrate into the AI tool context

**File:** `src/server/features/ai/tools/create.ts`

When creating a calendar event, check for related emails:

```typescript
case "calendar": {
  // Before creating the event, find related context
  if (data.attendees?.length) {
    const crossRef = await findCrossReferences({
      userId: context.userId,
      attendees: data.attendees,
      subject: data.title,
      logger,
    });

    // If there are related unanswered emails from attendees, mention them
    if (crossRef.relatedEmails?.length) {
      // Include in the response so the AI can reference them
    }
  }
  // ... existing event creation logic ...
}
```

### Step 4: Integrate into drive filing

**File:** `src/server/features/drive/filing-engine.ts` (or similar)

After filing a document, check if there's a related task:

```typescript
// After successful filing:
const crossRef = await findCrossReferences({
  userId,
  subject: filename,
  logger,
});

if (crossRef.relatedTasks?.length) {
  // Create a notification linking the filing to the task
  await createInAppNotification({
    userId,
    title: `Filed "${filename}" -- related task found`,
    body: `This might be related to your task: "${crossRef.relatedTasks[0].title}"`,
    type: "info",
    dedupeKey: `filing-task-${filingId}`,
  });
}
```

---

## Files to Modify

- `src/server/features/rules/ai/run-rules.ts` -- add cross-references to rule execution
- `src/server/features/ai/tools/create.ts` -- add cross-references to calendar creation
- `src/server/features/drive/filing-engine.ts` -- add cross-references to drive filing (if file exists)

## Files to Create

- `src/server/features/ai/cross-reference.ts` -- cross-reference service

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Create an email from "sarah@example.com" and a task with "Sarah" in the title
3. Call `findCrossReferences` with `emailAddress: "sarah@example.com"` and verify the task is found
4. Run tests: `bunx vitest run`

## Rollback Plan

Delete `cross-reference.ts` and remove the calls from modified files. Features revert to operating independently.

## Dependencies on Other Issues

- **Issue 10** (cross-feature FKs): Cross-feature FKs make cross-reference queries much more efficient and accurate.
- **Issue 12** (enrich context pack): The context pack can include cross-references for richer AI awareness.
