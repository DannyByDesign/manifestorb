# Issue 07: Wrap Feature-Siloed List API Endpoints as AI Tools

**Severity:** HIGH
**Category:** Dashboard/UI-Centric Architecture

---

## Problem

Five REST API endpoints exist solely to serve dashboard list views. They return paginated data designed for UI rendering, not for AI tool consumption:

1. `src/app/api/rules/route.ts` -- `GET` lists all rules
2. `src/app/api/notifications/route.ts` -- `GET` lists 50 notifications
3. `src/app/api/drafts/route.ts` -- `GET` lists all drafts with pagination
4. `src/app/api/conversations/route.ts` -- `GET` lists 50 conversations
5. `src/app/api/tasks/triage/route.ts` -- `GET` returns triage view data

The AI has no tool to query these resources contextually. Users must navigate to separate UI pages instead of asking the AI "show me my pending drafts" or "what notifications do I have."

---

## Root Cause

These endpoints were built for a dashboard-first architecture. The AI's `query` tool (`src/server/features/ai/tools/query.ts`) only supports `email`, `calendar`, `drive`, `automation`, `knowledge`, `report`, `patterns`, `contacts`, and `task` resources -- it does not expose `notifications`, `drafts`, or `conversations` as queryable resources.

---

## Step-by-Step Fix

### Step 1: Add `notification` resource to the query tool

**File:** `src/server/features/ai/tools/query.ts`

Find the `resource` enum in the parameters schema (around line 12):

```typescript
resource: z.enum([
  "email", "calendar", "drive", "automation", "knowledge", "report", "patterns", "contacts", "task"
]),
```

Add `"notification"` and `"draft"` and `"conversation"`:

```typescript
resource: z.enum([
  "email", "calendar", "drive", "automation", "knowledge", "report", "patterns", "contacts", "task",
  "notification", "draft", "conversation"
]),
```

### Step 2: Implement the `notification` query handler

**File:** `src/server/features/ai/tools/query.ts`

Inside the `execute` function, add a new case in the resource switch:

```typescript
case "notification": {
  const notifications = await prisma.inAppNotification.findMany({
    where: {
      userId: context.userId,
      ...(filter?.status ? { type: filter.status.toLowerCase() } : {}),
      ...(filter?.query ? {
        OR: [
          { title: { contains: filter.query, mode: "insensitive" } },
          { body: { contains: filter.query, mode: "insensitive" } },
        ],
      } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: filter?.limit ?? 20,
    select: {
      id: true,
      title: true,
      body: true,
      type: true,
      readAt: true,
      createdAt: true,
      metadata: true,
    },
  });
  return {
    success: true,
    data: notifications,
    message: notifications.length === 0
      ? "No notifications found."
      : `Found ${notifications.length} notification(s).`,
  };
}
```

### Step 3: Implement the `draft` query handler

**File:** `src/server/features/ai/tools/query.ts`

Add a new case:

```typescript
case "draft": {
  if (!providers.email) {
    return { success: false, error: "Email provider not available" };
  }
  const drafts = await providers.email.getDrafts({
    query: filter?.query,
    maxResults: filter?.limit ?? 20,
  });
  return {
    success: true,
    data: drafts,
    message: drafts.length === 0
      ? "No drafts found."
      : `Found ${drafts.length} draft(s).`,
  };
}
```

Note: Check whether `providers.email.getDrafts()` exists. If not, you may need to add it to the email provider interface. Look at the existing `GmailProvider` class to see if there is a `getDrafts` method or if it needs to be added.

### Step 4: Implement the `conversation` query handler

**File:** `src/server/features/ai/tools/query.ts`

Add a new case:

```typescript
case "conversation": {
  const conversations = await prisma.conversation.findMany({
    where: {
      userId: context.userId,
      ...(filter?.query ? {
        messages: {
          some: {
            content: { contains: filter.query, mode: "insensitive" },
          },
        },
      } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: filter?.limit ?? 20,
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 3,
        select: {
          role: true,
          content: true,
          createdAt: true,
          provider: true,
        },
      },
    },
  });
  return {
    success: true,
    data: conversations.map(c => ({
      id: c.id,
      provider: c.provider,
      updatedAt: c.updatedAt,
      recentMessages: c.messages,
    })),
    message: conversations.length === 0
      ? "No conversations found."
      : `Found ${conversations.length} conversation(s).`,
  };
}
```

### Step 5: Update the tool description

**File:** `src/server/features/ai/tools/query.ts`

Update the `description` string to document the new resources:

```typescript
description: `Search and retrieve items from any resource.

Resources:
- email: Search emails (supports Gmail/Outlook query syntax)
- calendar: Search events by date range, attendees, title
- task: Search tasks by title/description
- automation: List rules and their configurations
- notification: Search notifications by title/body, filter by type
- draft: List email drafts, optionally filter by query
- conversation: Search conversation history across all platforms`,
```

---

## Files to Modify

- `src/server/features/ai/tools/query.ts` -- add `notification`, `draft`, `conversation` resources

## Files to Create

None.

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Test manually via the AI chat: ask "show me my notifications" and "do I have any drafts"
3. Run existing query tool tests (if any): `bunx vitest run src/server/features/ai/tools/`

## Rollback Plan

Revert `query.ts` via git. The new resources are additive -- removing them has no side effects.

## Dependencies on Other Issues

- None. This is an additive change.
