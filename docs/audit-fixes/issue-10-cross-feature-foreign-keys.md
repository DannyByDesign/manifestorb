# Issue 10: Add Cross-Feature Foreign Keys to Database Schema

**Severity:** CRITICAL
**Category:** Feature Siloing

---

## Problem

Major Prisma models lack cross-feature relationships, preventing the AI from reasoning holistically across email, calendar, tasks, and drive:

1. **Task has no link to Email**: `Task` model (lines 1012-1041 in `prisma/schema.prisma`) has no reference to the email or conversation that created it.
2. **Calendar has no link to Email**: `CalendarActionLog` (lines 1084-1102) has no `relatedEmailId` or `relatedThreadId`.
3. **DocumentFiling lacks Calendar/Task links**: `DocumentFiling` (lines 1169-1208) references emails via `messageId` string but not calendar events or tasks.
4. **Conversation has no domain references**: `Conversation` (lines 842-861) has no link to related emails, calendar events, or tasks.
5. **ApprovalRequest has no source tracking**: `ApprovalRequest` (lines 1443-1468) has no `sourceType`/`sourceId` to track what triggered it.
6. **ExecutedRule uses string IDs, not FKs**: `ExecutedRule` (lines 507-532) stores `threadId` and `messageId` as plain strings, not as foreign keys to `EmailMessage`.

---

## Root Cause

Each feature (email, calendar, tasks, drive) was built independently. The schema was never refactored to add cross-references.

---

## Step-by-Step Fix

All changes are **additive** (new optional columns). No existing data or code breaks.

### Step 1: Add source tracking to Task model

**File:** `prisma/schema.prisma`

Find the `Task` model (around line 1012). Add these fields before the `@@index` lines:

```prisma
model Task {
  // ... existing fields ...

  // Cross-feature: where this task originated
  sourceEmailMessageId String?
  sourceEmailMessage   EmailMessage? @relation("TaskSourceEmail", fields: [sourceEmailMessageId], references: [id], onDelete: SetNull)
  sourceConversationId String?
  sourceConversation   Conversation? @relation("TaskSourceConversation", fields: [sourceConversationId], references: [id], onDelete: SetNull)

  // ... existing relations and indexes ...
  @@index([sourceEmailMessageId])
}
```

Then add the reverse relation to the `EmailMessage` model:

```prisma
model EmailMessage {
  // ... existing fields ...
  sourcedTasks Task[] @relation("TaskSourceEmail")
}
```

And to the `Conversation` model:

```prisma
model Conversation {
  // ... existing fields ...
  sourcedTasks Task[] @relation("TaskSourceConversation")
}
```

### Step 2: Add email reference to CalendarActionLog

**File:** `prisma/schema.prisma`

Find the `CalendarActionLog` model (around line 1084). Add:

```prisma
model CalendarActionLog {
  // ... existing fields ...

  // Cross-feature: related email thread
  relatedThreadId  String?
  relatedMessageId String?

  // ... existing indexes ...
  @@index([relatedThreadId])
}
```

### Step 3: Add source tracking to ApprovalRequest

**File:** `prisma/schema.prisma`

Find the `ApprovalRequest` model (around line 1443). Add:

```prisma
model ApprovalRequest {
  // ... existing fields ...

  // Cross-feature: what triggered this approval
  sourceType String?  // "email_rule" | "ai_tool" | "task_scheduler" | "calendar"
  sourceId   String?  // ID of the source entity (e.g., executedRuleId, taskId)

  // ... existing indexes ...
  @@index([sourceType, sourceId])
}
```

### Step 4: Add task/calendar references to DocumentFiling

**File:** `prisma/schema.prisma`

Find the `DocumentFiling` model (around line 1169). Add:

```prisma
model DocumentFiling {
  // ... existing fields ...

  // Cross-feature: related task or calendar event
  relatedTaskId String?
  relatedTask   Task? @relation(fields: [relatedTaskId], references: [id], onDelete: SetNull)

  // ... existing indexes ...
}
```

Add the reverse relation to Task:

```prisma
model Task {
  // ... existing fields and new fields from Step 1 ...
  documentFilings DocumentFiling[]
}
```

### Step 5: Add domain references to Conversation

**File:** `prisma/schema.prisma`

Find the `Conversation` model (around line 842). Add:

```prisma
model Conversation {
  // ... existing fields ...

  // Cross-feature: primary topic references
  relatedEmailThreadId String?  // Gmail/Outlook thread ID for context
  relatedCalendarEventId String?

  // ... existing relations ...
  // sourcedTasks added in Step 1
}
```

### Step 6: Create the migration

Run:

```bash
bunx prisma migrate dev --name add_cross_feature_foreign_keys
```

Review the generated SQL to ensure it only contains `ALTER TABLE ... ADD COLUMN` statements with nullable columns and `CREATE INDEX` statements.

### Step 7: Populate source fields in code that creates these records

After migration, update code that creates Tasks, ApprovalRequests, and DocumentFilings to pass the new source fields when available.

**File:** `src/server/features/ai/actions.ts` (SCHEDULE_MEETING action)

When creating an ApprovalRequest, add `sourceType` and `sourceId`:

```typescript
const approvalRequest = await approvalService.createRequest({
  // ... existing fields ...
  sourceType: "email_rule",
  sourceId: executedRuleId, // pass this from the calling context
});
```

**File:** `src/server/features/ai/tools/create.ts` (task creation)

When creating a Task from an AI tool call, check if the conversation has email context:

```typescript
// If the user is creating a task from an email context, link it
const task = await prisma.task.create({
  data: {
    // ... existing fields ...
    sourceEmailMessageId: context.emailMessageId ?? undefined,
    sourceConversationId: context.conversationId ?? undefined,
  },
});
```

---

## Files to Modify

- `prisma/schema.prisma` -- add optional FK fields to Task, CalendarActionLog, ApprovalRequest, DocumentFiling, Conversation
- `src/server/features/ai/actions.ts` -- populate sourceType/sourceId on ApprovalRequest creation
- `src/server/features/ai/tools/create.ts` -- populate source fields on Task creation

## Files to Create

- `prisma/migrations/<timestamp>_add_cross_feature_foreign_keys/migration.sql` (auto-generated)

## Testing Instructions

1. Run migration: `bunx prisma migrate dev`
2. Verify schema is valid: `bunx prisma validate`
3. Verify TypeScript compiles: `bunx tsc --noEmit`
4. Run all tests to confirm nothing breaks: `bunx vitest run`
5. Create a task via the AI and verify `sourceConversationId` is populated in the database

## Rollback Plan

Create a new migration that drops the added columns. Since all new columns are nullable, no data loss occurs.

## Dependencies on Other Issues

- **Issue 12** (enrich context pack): Once cross-feature FKs exist, the context pack can use them to load related domain objects.
- **Issue 28** (cross-integration workflows): Cross-feature FKs enable the queries needed for cross-integration awareness.
