# Issue 11: Migrate Knowledge Base from Per-Email-Account to Per-User

**Severity:** HIGH
**Category:** Feature Siloing

---

## Problem

The `Knowledge` model in `prisma/schema.prisma` (around line 829) is scoped to `emailAccountId`:

```prisma
model Knowledge {
  id        String   @id @default(cuid())
  title     String
  content   String
  emailAccountId String
  emailAccount   EmailAccount @relation(fields: [emailAccountId], references: [id], onDelete: Cascade)
  @@unique([emailAccountId, title])
}
```

And in `src/server/features/memory/context-manager.ts` (line 125-129), knowledge search uses `emailAccountId`:

```typescript
searchKnowledge({
  emailAccountId: emailAccount.id,
  query: messageContent,
  limit: 5
})
```

A user with multiple email accounts (e.g., personal + work) has completely separate knowledge bases. Knowledge created from one account is invisible when using another.

---

## Root Cause

Knowledge was built as a feature of the email account, not of the user. The schema and all queries scope by `emailAccountId`.

---

## Step-by-Step Fix

### Step 1: Add `userId` to the Knowledge model

**File:** `prisma/schema.prisma`

Find the `Knowledge` model (around line 829). Add `userId` field and update the unique constraint:

```prisma
model Knowledge {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  title     String
  content   String

  // Keep emailAccountId for backward compatibility (nullable now)
  emailAccountId String?
  emailAccount   EmailAccount? @relation(fields: [emailAccountId], references: [id], onDelete: SetNull)

  // New: user-level ownership
  userId String
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, title])  // Changed from [emailAccountId, title]
  @@index([userId])
}
```

Add the reverse relation to the `User` model:

```prisma
model User {
  // ... existing fields ...
  knowledge Knowledge[]
}
```

### Step 2: Create the migration

Run:

```bash
bunx prisma migrate dev --name knowledge_per_user --create-only
```

This creates the migration file without applying it. Edit the generated SQL to:

1. Add the `userId` column (NOT NULL with a default derived from the emailAccount):
2. Backfill `userId` from the existing `emailAccountId` relation:

```sql
-- Add userId column (nullable initially)
ALTER TABLE "Knowledge" ADD COLUMN "userId" TEXT;

-- Backfill userId from EmailAccount
UPDATE "Knowledge" k
SET "userId" = ea."userId"
FROM "EmailAccount" ea
WHERE k."emailAccountId" = ea.id;

-- Make userId NOT NULL
ALTER TABLE "Knowledge" ALTER COLUMN "userId" SET NOT NULL;

-- Make emailAccountId nullable
ALTER TABLE "Knowledge" ALTER COLUMN "emailAccountId" DROP NOT NULL;

-- Drop old unique constraint
ALTER TABLE "Knowledge" DROP CONSTRAINT IF EXISTS "Knowledge_emailAccountId_title_key";

-- Add new unique constraint
ALTER TABLE "Knowledge" ADD CONSTRAINT "Knowledge_userId_title_key" UNIQUE ("userId", "title");

-- Add index
CREATE INDEX "Knowledge_userId_idx" ON "Knowledge"("userId");

-- Add FK constraint
ALTER TABLE "Knowledge" ADD CONSTRAINT "Knowledge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
```

Then apply: `bunx prisma migrate dev`

### Step 3: Update `searchKnowledge` to use `userId`

**File:** `src/server/features/memory/embeddings/search.ts` (or wherever `searchKnowledge` is defined)

Find the `searchKnowledge` function. Change its parameter from `emailAccountId` to `userId`:

```typescript
// Before:
export async function searchKnowledge({
  emailAccountId,
  query,
  limit,
}: {
  emailAccountId: string;
  query: string;
  limit: number;
})

// After:
export async function searchKnowledge({
  userId,
  query,
  limit,
}: {
  userId: string;
  query: string;
  limit: number;
})
```

Update the WHERE clause in the query from `WHERE "emailAccountId" = ...` to `WHERE "userId" = ...`.

### Step 4: Update `buildContextPack` to pass `userId`

**File:** `src/server/features/memory/context-manager.ts`

Change lines 125-129 from:

```typescript
searchKnowledge({
  emailAccountId: emailAccount.id,
  query: messageContent,
  limit: 5
})
```

To:

```typescript
searchKnowledge({
  userId: user.id,
  query: messageContent,
  limit: 5
})
```

### Step 5: Update knowledge creation actions

**File:** `src/server/actions/knowledge.ts`

Update `createKnowledgeAction` to include `userId`:

Find the Prisma `create` call and add `userId`:

```typescript
await prisma.knowledge.create({
  data: {
    title,
    content,
    userId: session.user.id,  // Add this
    emailAccountId: emailAccountId,  // Keep for backward compat
  },
});
```

### Step 6: Update the AI knowledge creation tool

**File:** `src/server/features/ai/tools/create.ts`

In the `knowledge` case of the create tool's execute function, ensure `userId` is passed:

```typescript
case "knowledge": {
  const knowledge = await prisma.knowledge.create({
    data: {
      title: data.title!,
      content: data.content!,
      userId: context.userId,  // Add this
      emailAccountId: context.emailAccountId,
    },
  });
  return { success: true, data: knowledge };
}
```

### Step 7: Update all other references to Knowledge queries

Search the codebase for all queries on the `Knowledge` model that filter by `emailAccountId` and update them to filter by `userId` instead:

```bash
rg "knowledge.*emailAccountId" --type ts
rg "Knowledge.*emailAccountId" --type ts
```

Update each occurrence.

---

## Files to Modify

- `prisma/schema.prisma` -- add `userId` to Knowledge, update unique constraint
- `src/server/features/memory/embeddings/search.ts` -- change `searchKnowledge` parameter
- `src/server/features/memory/context-manager.ts` -- pass `userId` instead of `emailAccountId`
- `src/server/actions/knowledge.ts` -- add `userId` to create/update calls
- `src/server/features/ai/tools/create.ts` -- add `userId` to knowledge creation
- Any other files that query Knowledge by emailAccountId (find with grep)

## Files to Create

- `prisma/migrations/<timestamp>_knowledge_per_user/migration.sql` (created and edited)

## Testing Instructions

1. Apply migration: `bunx prisma migrate dev`
2. Verify existing knowledge entries have `userId` populated (check database)
3. Create a new knowledge entry via AI -- verify it has `userId` set
4. Search knowledge from a different email account of the same user -- verify it finds entries
5. Run tests: `bunx vitest run src/server/features/memory/`
6. Verify TypeScript compiles: `bunx tsc --noEmit`

## Rollback Plan

Create a reverse migration that drops the `userId` column and restores the `emailAccountId` unique constraint. Existing data is preserved since `emailAccountId` is kept as an optional field.

## Dependencies on Other Issues

- **Issue 12** (enrich context pack): The context pack can now use user-level knowledge regardless of email account.
- **Issue 14** (user ID as primary identifier): This is one concrete step toward the broader pattern of using `userId` instead of `emailAccountId`.
