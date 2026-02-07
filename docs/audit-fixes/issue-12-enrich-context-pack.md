# Issue 12: Enrich Context Pack with Domain Objects

**Severity:** HIGH
**Category:** Feature Siloing

---

## Problem

The `buildContextPack()` function in `src/server/features/memory/context-manager.ts` (lines 98-323) returns:
- User summary
- Memory facts (via embedding search)
- Knowledge entries (via embedding search)
- Conversation history (last 30 messages)
- Pending approvals/schedule proposals

It does **NOT** include:
- Active/recent email threads
- Upcoming calendar events
- Pending tasks
- Recent drive filings

This means the AI has no awareness of the user's current email, calendar, or task state. It cannot say "You have a meeting with Sarah in 30 minutes" or "You still haven't replied to John's email from this morning."

---

## Root Cause

The context pack was designed for conversation memory, not holistic awareness. Domain object queries were never integrated.

---

## Step-by-Step Fix

### Step 1: Define domain object types in the context pack

**File:** `src/server/features/memory/context-manager.ts`

Find the `ContextPack` interface (around lines 73-95). Add a `domain` section:

```typescript
export interface ContextPack {
  system: {
    basePrompt: string;
    safetyGuardrails: string[];
    legacyAbout?: string;
    summary?: string;
  };
  facts: MemoryFact[];
  knowledge: Knowledge[];
  history: ConversationMessage[];
  documents: unknown[];
  pendingState?: PendingStateContext;
  // NEW: Domain objects for holistic awareness
  domain?: {
    upcomingEvents: Array<{
      id: string;
      title: string;
      start: Date;
      end: Date;
      attendees?: string[];
      location?: string;
    }>;
    recentEmails: Array<{
      threadId: string;
      subject: string;
      from: string;
      snippet: string;
      receivedAt: Date;
      needsReply: boolean;
    }>;
    pendingTasks: Array<{
      id: string;
      title: string;
      dueDate?: Date;
      priority?: string;
      status: string;
    }>;
    recentFilings: Array<{
      filename: string;
      folderPath: string;
      filedAt: Date;
    }>;
  };
}
```

### Step 2: Fetch upcoming calendar events

**File:** `src/server/features/memory/context-manager.ts`

Inside `buildContextPack()`, after the parallel fact/knowledge search block (around line 170), add domain object fetches. Run them in parallel:

```typescript
// Fetch domain objects in parallel
const [upcomingEvents, recentEmails, pendingTasks, recentFilings] = await Promise.all([
  // Upcoming calendar events (next 24 hours)
  prisma.$queryRaw`
    SELECT id, title, "startTime" as start, "endTime" as end, attendees, location
    FROM "CalendarEvent"
    WHERE "userId" = ${user.id}
      AND "startTime" > NOW()
      AND "startTime" < NOW() + INTERVAL '24 hours'
    ORDER BY "startTime" ASC
    LIMIT 10
  `.catch(() => []),

  // Recent emails needing reply (last 48 hours, unread or "TO_REPLY")
  prisma.$queryRaw`
    SELECT t."threadId", t.subject, t."fromAddress" as from, t.snippet, t."receivedAt",
           CASE WHEN t."systemType" = 'TO_REPLY' THEN true ELSE false END as "needsReply"
    FROM "EmailThread" t
    JOIN "EmailAccount" ea ON t."emailAccountId" = ea.id
    WHERE ea."userId" = ${user.id}
      AND t."receivedAt" > NOW() - INTERVAL '48 hours'
    ORDER BY t."receivedAt" DESC
    LIMIT 10
  `.catch(() => []),

  // Pending tasks
  prisma.task.findMany({
    where: {
      userId: user.id,
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
    orderBy: [
      { dueDate: "asc" },
      { priority: "desc" },
    ],
    take: 10,
    select: {
      id: true,
      title: true,
      dueDate: true,
      priority: true,
      status: true,
    },
  }).catch(() => []),

  // Recent drive filings (last 7 days)
  prisma.documentFiling.findMany({
    where: {
      emailAccount: { userId: user.id },
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      filename: true,
      folderPath: true,
      createdAt: true,
    },
  }).catch(() => []),
]);
```

**Important:** The exact table/column names in the raw SQL queries above may not match your schema exactly. Check the actual Prisma model names:
- For calendar events, check if the model is `CalendarEvent` or if events are stored differently (possibly in `Calendar` + events via Google API). If events are not stored in the database (only synced on-demand), you will need to call the calendar provider API instead.
- For email threads, check if there is an `EmailThread` or `EmailMessage` model with the fields shown above. Adjust column names accordingly.

If certain models don't exist or use different names, use Prisma's typed client instead of raw SQL:

```typescript
// Example using Prisma client for tasks
const pendingTasks = await prisma.task.findMany({
  where: { userId: user.id, status: { in: ["PENDING", "IN_PROGRESS"] } },
  orderBy: [{ dueDate: "asc" }],
  take: 10,
  select: { id: true, title: true, dueDate: true, priority: true, status: true },
}).catch(() => []);
```

### Step 3: Include domain objects in the context pack

**File:** `src/server/features/memory/context-manager.ts`

In the return statement of `buildContextPack()` (around where `applyTokenBudget` is called), add:

```typescript
const contextPack = this.applyTokenBudget({
  // ... existing fields ...
  domain: {
    upcomingEvents: upcomingEvents as ContextPack["domain"]["upcomingEvents"],
    recentEmails: recentEmails as ContextPack["domain"]["recentEmails"],
    pendingTasks: pendingTasks as ContextPack["domain"]["pendingTasks"],
    recentFilings: (recentFilings || []).map(f => ({
      filename: f.filename,
      folderPath: f.folderPath,
      filedAt: f.createdAt,
    })),
  },
});
```

### Step 4: Include domain objects in the system prompt

**File:** `src/server/features/channels/executor.ts`

In the system message construction (around lines 215-230), add a domain context block:

```typescript
const domainBlock = contextPack.domain ? `
## Current State (auto-retrieved)
${contextPack.domain.upcomingEvents.length > 0 ? `### Upcoming Events (next 24h)
${contextPack.domain.upcomingEvents.map(e => `- ${e.title} at ${new Date(e.start).toLocaleString()} ${e.attendees?.length ? `with ${e.attendees.join(", ")}` : ""}`).join("\n")}` : ""}
${contextPack.domain.recentEmails.length > 0 ? `### Recent Emails
${contextPack.domain.recentEmails.filter(e => e.needsReply).map(e => `- [Needs reply] "${e.subject}" from ${e.from}`).join("\n")}` : ""}
${contextPack.domain.pendingTasks.length > 0 ? `### Pending Tasks
${contextPack.domain.pendingTasks.map(t => `- ${t.title}${t.dueDate ? ` (due ${new Date(t.dueDate).toLocaleDateString()})` : ""} [${t.status}]`).join("\n")}` : ""}
` : "";
```

Insert `${domainBlock}` into the system message content string.

### Step 5: Do the same in `chat.ts`

**File:** `src/server/features/web-chat/ai/chat.ts`

Add the same domain block to the `systemWithContext` string (around line 175). Use the same template as Step 4.

### Step 6: Update `applyTokenBudget` to handle domain objects

**File:** `src/server/features/memory/context-manager.ts`

Find the `applyTokenBudget` method. Ensure it passes through the `domain` field and optionally truncates if the total context exceeds the token budget. The simplest approach: if over budget, reduce `recentEmails` and `pendingTasks` counts first.

---

## Files to Modify

- `src/server/features/memory/context-manager.ts` -- add domain type, fetch domain objects, include in pack
- `src/server/features/channels/executor.ts` -- render domain objects in system prompt
- `src/server/features/web-chat/ai/chat.ts` -- render domain objects in system prompt

## Files to Create

None.

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Create some test data (a pending task, an upcoming calendar event) and verify the context pack includes them
3. Ask the AI "what do I have coming up today" and verify it references real calendar/task data
4. Run tests: `bunx vitest run src/server/features/memory/`

## Rollback Plan

Revert the three modified files. The context pack will return to its previous state without domain objects.

## Dependencies on Other Issues

- **Issue 10** (cross-feature FKs): Cross-feature FKs enable richer queries (e.g., "this task was created from this email").
- **Issue 11** (knowledge per user): Should be done first so knowledge is also user-scoped in the pack.
- **Issue 26** (proactive context): This issue provides the data layer; Issue 26 builds the proactive surfacing logic on top.
