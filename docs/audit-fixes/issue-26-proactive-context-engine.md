# Issue 26: Build Proactive Context Engine for Surfacing Items Requiring Attention

**Severity:** HIGH
**Category:** Context & Memory

---

## Problem

In `src/server/features/memory/context-manager.ts`, context is only built reactively when the user sends a message. The AI has no mechanism to proactively surface relevant information like:

- "You have an unanswered email from your boss from 2 hours ago"
- "Your meeting with Sarah starts in 15 minutes -- she sent a prep doc yesterday"
- "You have 3 overdue tasks"
- "The proposal John asked about last week is still in draft"

The AI waits passively for the user to ask, rather than behaving like a human executive assistant who proactively flags items.

---

## Root Cause

The system was designed as request-response: user sends message, AI responds. No background process evaluates what the user should know about.

---

## Step-by-Step Fix

### Step 1: Define attention-worthy item types

**File:** `src/server/features/ai/proactive/types.ts` (NEW FILE)

```typescript
export interface AttentionItem {
  id: string;
  type: "unanswered_email" | "upcoming_meeting" | "overdue_task" | "pending_approval" | "follow_up_due";
  urgency: "high" | "medium" | "low";
  title: string;
  description: string;
  actionable: boolean;   // Can the AI take action on this?
  suggestedAction?: string; // e.g., "draft a reply", "prepare for meeting"
  relatedEntityId: string;
  relatedEntityType: string; // "email" | "calendar" | "task" | "approval"
  detectedAt: Date;
}
```

### Step 2: Create the attention scanner

**File:** `src/server/features/ai/proactive/scanner.ts` (NEW FILE)

```typescript
import prisma from "@/server/db/client";
import type { AttentionItem } from "./types";

/**
 * Scan the user's data for items that need attention.
 * This runs periodically or on app open.
 */
export async function scanForAttentionItems(userId: string): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const now = new Date();

  // 1. Unanswered important emails (> 2 hours old, marked TO_REPLY)
  // NOTE: Adjust model/field names to match actual schema
  const unansweredEmails = await prisma.$queryRaw<
    Array<{ threadId: string; subject: string; fromAddress: string; receivedAt: Date }>
  >`
    SELECT DISTINCT ON (t."threadId") t."threadId", t.subject, t."fromAddress", t."receivedAt"
    FROM "EmailThread" t
    JOIN "EmailAccount" ea ON t."emailAccountId" = ea.id
    WHERE ea."userId" = ${userId}
      AND t."systemType" = 'TO_REPLY'
      AND t."receivedAt" < ${new Date(now.getTime() - 2 * 60 * 60 * 1000)}
      AND t."receivedAt" > ${new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)}
    ORDER BY t."threadId", t."receivedAt" DESC
    LIMIT 5
  `.catch(() => []);

  for (const email of unansweredEmails) {
    const hoursOld = Math.round((now.getTime() - email.receivedAt.getTime()) / (1000 * 60 * 60));
    items.push({
      id: `unanswered-${email.threadId}`,
      type: "unanswered_email",
      urgency: hoursOld > 24 ? "high" : "medium",
      title: `Unanswered: "${email.subject}" from ${email.fromAddress}`,
      description: `Received ${hoursOld} hours ago. Marked as needing a reply.`,
      actionable: true,
      suggestedAction: "Draft a reply",
      relatedEntityId: email.threadId,
      relatedEntityType: "email",
      detectedAt: now,
    });
  }

  // 2. Upcoming meetings in the next 30 minutes
  // NOTE: Adjust if calendar events are stored differently
  const upcomingMeetings = await prisma.calendarActionLog.findMany({
    where: {
      userId,
      action: "create",
      createdAt: {
        gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), // Last 30 days of created events
      },
    },
    select: { payload: true, eventId: true },
    take: 20,
  }).catch(() => []);

  // Filter for events starting in next 30 minutes
  for (const meeting of upcomingMeetings) {
    const payload = meeting.payload as Record<string, unknown> | null;
    if (!payload?.start) continue;
    const start = new Date(payload.start as string);
    const minutesUntil = (start.getTime() - now.getTime()) / (1000 * 60);
    if (minutesUntil > 0 && minutesUntil <= 30) {
      items.push({
        id: `upcoming-${meeting.eventId}`,
        type: "upcoming_meeting",
        urgency: minutesUntil <= 10 ? "high" : "medium",
        title: `Meeting "${(payload.title as string) || "Untitled"}" in ${Math.round(minutesUntil)} minutes`,
        description: `Starts at ${start.toLocaleTimeString()}`,
        actionable: false,
        relatedEntityId: meeting.eventId || "",
        relatedEntityType: "calendar",
        detectedAt: now,
      });
    }
  }

  // 3. Overdue tasks
  const overdueTasks = await prisma.task.findMany({
    where: {
      userId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
      dueDate: { lt: now },
    },
    select: { id: true, title: true, dueDate: true, priority: true },
    orderBy: { dueDate: "asc" },
    take: 5,
  }).catch(() => []);

  for (const task of overdueTasks) {
    const daysOverdue = Math.round((now.getTime() - (task.dueDate?.getTime() ?? 0)) / (1000 * 60 * 60 * 24));
    items.push({
      id: `overdue-${task.id}`,
      type: "overdue_task",
      urgency: daysOverdue > 3 ? "high" : task.priority === "HIGH" ? "high" : "medium",
      title: `Overdue: "${task.title}"`,
      description: `Due ${daysOverdue} day(s) ago.`,
      actionable: true,
      suggestedAction: "Reschedule or complete",
      relatedEntityId: task.id,
      relatedEntityType: "task",
      detectedAt: now,
    });
  }

  // 4. Expiring approvals
  const expiringApprovals = await prisma.approvalRequest.findMany({
    where: {
      userId,
      status: "PENDING",
      expiresAt: {
        gt: now,
        lt: new Date(now.getTime() + 60 * 60 * 1000), // Expires in next hour
      },
    },
    select: { id: true, requestPayload: true, expiresAt: true },
    take: 5,
  }).catch(() => []);

  for (const approval of expiringApprovals) {
    const payload = approval.requestPayload as Record<string, unknown>;
    const minutesLeft = Math.round((approval.expiresAt.getTime() - now.getTime()) / (1000 * 60));
    items.push({
      id: `expiring-${approval.id}`,
      type: "pending_approval",
      urgency: minutesLeft < 15 ? "high" : "medium",
      title: `Approval expiring: "${(payload.description as string) || "Action pending"}"`,
      description: `Expires in ${minutesLeft} minutes.`,
      actionable: true,
      suggestedAction: "Approve or deny",
      relatedEntityId: approval.id,
      relatedEntityType: "approval",
      detectedAt: now,
    });
  }

  // Sort by urgency (high first) then by detection time
  const urgencyOrder = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  return items;
}
```

### Step 3: Inject attention items into the context pack

**File:** `src/server/features/memory/context-manager.ts`

In `buildContextPack()`, call the scanner and include results:

```typescript
import { scanForAttentionItems } from "@/features/ai/proactive/scanner";

// Inside buildContextPack(), add to the parallel fetches:
const attentionItems = await scanForAttentionItems(user.id).catch(() => []);

// Add to the ContextPack interface:
attentionItems?: AttentionItem[];
```

### Step 4: Render attention items in the system prompt

**File:** `src/server/features/channels/executor.ts` (and/or unified pipeline)

Add an attention block to the system prompt:

```typescript
const attentionBlock = contextPack.attentionItems?.length
  ? `
## Items Requiring Your Attention
${contextPack.attentionItems.map(item => `- [${item.urgency.toUpperCase()}] ${item.title}: ${item.description}${item.suggestedAction ? ` (Suggested: ${item.suggestedAction})` : ""}`).join("\n")}

If the user hasn't asked about something specific, proactively mention the HIGH urgency items above.
`
  : "";
```

### Step 5: Add system prompt instruction for proactive behavior

**File:** `src/server/features/ai/system-prompt.ts`

Add:

```typescript
## Proactive Behavior
When the user opens a conversation or sends a vague message like "hi" or "what's up", check the "Items Requiring Your Attention" section and proactively mention HIGH urgency items. For example: "Good morning! Quick heads up: you have an unanswered email from your boss (sent 3 hours ago) and a meeting with Sarah in 20 minutes."
```

### Step 6: Trigger scanning on app open (optional API endpoint)

**File:** `src/app/api/context/attention/route.ts` (NEW FILE)

Create an API endpoint that the web UI can call on load to get attention items:

```typescript
import { scanForAttentionItems } from "@/features/ai/proactive/scanner";
import { auth } from "@/server/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const items = await scanForAttentionItems(session.user.id);
  return Response.json({ items });
}
```

---

## Files to Modify

- `src/server/features/memory/context-manager.ts` -- include attention items in pack
- `src/server/features/channels/executor.ts` -- render attention block in prompt
- `src/server/features/web-chat/ai/chat.ts` -- render attention block in prompt
- `src/server/features/ai/system-prompt.ts` -- add proactive behavior instructions

## Files to Create

- `src/server/features/ai/proactive/types.ts` -- attention item types
- `src/server/features/ai/proactive/scanner.ts` -- attention scanner
- `src/app/api/context/attention/route.ts` -- API endpoint for web UI (optional)

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Create test data: an old unanswered email, an upcoming meeting, an overdue task
3. Call `scanForAttentionItems(userId)` and verify all three are returned
4. Start a new AI conversation with "hi" and verify the AI mentions the attention items
5. Run tests: `bunx vitest run`

## Rollback Plan

Delete the new files and revert modified files. The context pack returns to its reactive-only state.

## Dependencies on Other Issues

- **Issue 12** (enrich context pack): Provides the domain object infrastructure that the scanner queries.
- **Issue 10** (cross-feature FKs): Cross-feature FKs enable richer attention items (e.g., "task from Sarah's email is overdue").
- **Issue 17** (unify pipelines): Attention items should be injected once in the unified pipeline.
