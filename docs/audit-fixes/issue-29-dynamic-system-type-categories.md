# Issue 29: Replace Hardcoded SystemType Enum with Dynamic Categories

**Severity:** MEDIUM
**Category:** Enum & Schema Design

---

## Problem

The `SystemType` enum in `prisma/schema.prisma` (lines 1353-1367) has fixed categories:

```prisma
enum SystemType {
  TO_REPLY
  FYI
  AWAITING_REPLY
  ACTIONED
  COLD_EMAIL
  NEWSLETTER
  MARKETING
  CALENDAR
  RECEIPT
  NOTIFICATION
}
```

These are dashboard-era inbox categories. Problems:
1. Users cannot create custom categories (e.g., "Client Work", "Internal", "Personal")
2. Categories are not learned from behavior
3. Adding a new category requires a schema migration
4. The categories reflect a "inbox triage" dashboard mindset, not an AI assistant workflow

---

## Root Cause

Categories were defined as a Prisma enum during the dashboard era. Each category was hardcoded because it mapped to a specific UI view.

---

## Step-by-Step Fix

### Important Note

Replacing a Prisma enum that is used across the codebase is a significant change. This plan takes an incremental approach: keep the existing enum for backward compatibility while adding a flexible category system on top.

### Step 1: Create a `Category` model for user-defined categories

**File:** `prisma/schema.prisma`

```prisma
model Category {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  name        String
  description String?
  color       String?   // Optional hex color for UI
  isSystem    Boolean   @default(false)  // true for built-in categories
  isLearned   Boolean   @default(false)  // true for AI-learned categories

  userId String
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, name])
  @@index([userId])
}
```

Add reverse relation to User:

```prisma
model User {
  // ... existing fields ...
  categories Category[]
}
```

### Step 2: Create the migration

```bash
bunx prisma migrate dev --name add_dynamic_categories
```

### Step 3: Seed default categories from existing SystemType values

Create a seed or migration script:

```typescript
// For each user, create Category rows for the existing SystemType values:
const systemCategories = [
  { name: "To Reply", isSystem: true },
  { name: "FYI", isSystem: true },
  { name: "Awaiting Reply", isSystem: true },
  { name: "Actioned", isSystem: true },
  { name: "Cold Email", isSystem: true },
  { name: "Newsletter", isSystem: true },
  { name: "Marketing", isSystem: true },
  { name: "Calendar", isSystem: true },
  { name: "Receipt", isSystem: true },
  { name: "Notification", isSystem: true },
];
```

### Step 4: Add a `categoryId` field to relevant models

**File:** `prisma/schema.prisma`

Find models that use `systemType` (e.g., `Rule`, `EmailThread`, etc.):

```prisma
model Rule {
  // ... existing fields ...
  systemType  SystemType?  // Keep for backward compatibility
  categoryId  String?      // NEW: reference to dynamic Category
  category    Category?    @relation(fields: [categoryId], references: [id], onDelete: SetNull)
}
```

### Step 5: Create a category resolution helper

**File:** `src/server/features/categories/resolve.ts` (NEW FILE)

```typescript
import prisma from "@/server/db/client";

/**
 * Resolve a SystemType enum value to a Category id.
 * Used during the transition period.
 */
export async function resolveSystemTypeToCategory(
  userId: string,
  systemType: string,
): Promise<string | null> {
  const nameMap: Record<string, string> = {
    TO_REPLY: "To Reply",
    FYI: "FYI",
    AWAITING_REPLY: "Awaiting Reply",
    ACTIONED: "Actioned",
    COLD_EMAIL: "Cold Email",
    NEWSLETTER: "Newsletter",
    MARKETING: "Marketing",
    CALENDAR: "Calendar",
    RECEIPT: "Receipt",
    NOTIFICATION: "Notification",
  };

  const name = nameMap[systemType];
  if (!name) return null;

  const category = await prisma.category.findUnique({
    where: { userId_name: { userId, name } },
    select: { id: true },
  });

  return category?.id ?? null;
}

/**
 * Get or create a category for a user.
 * Used when the AI learns a new category from behavior.
 */
export async function getOrCreateCategory({
  userId,
  name,
  description,
  isLearned = false,
}: {
  userId: string;
  name: string;
  description?: string;
  isLearned?: boolean;
}): Promise<string> {
  const existing = await prisma.category.findUnique({
    where: { userId_name: { userId, name } },
  });

  if (existing) return existing.id;

  const created = await prisma.category.create({
    data: { userId, name, description, isLearned },
  });

  return created.id;
}
```

### Step 6: Add category management to AI tools

**File:** `src/server/features/ai/tools/create.ts`

In the `automation` case, support creating custom categories:

```typescript
if (resource === "category" || data.categoryName) {
  const { getOrCreateCategory } = await import("@/features/categories/resolve");
  const categoryId = await getOrCreateCategory({
    userId: context.userId,
    name: data.categoryName as string || data.name as string,
    description: data.description as string,
  });
  return { success: true, data: { categoryId } };
}
```

### Step 7: Update system prompt with category awareness

**File:** `src/server/features/ai/system-prompt.ts`

Replace the hardcoded categories mention:

```typescript
// Before (lines 135-140):
`- Emails are automatically categorized as "To Reply", "FYI", "Awaiting Reply", or "Actioned".`

// After:
// Load user's categories dynamically (see Issue 21 for how userConfig is passed)
const categoryList = userCategories?.length
  ? userCategories.map(c => `"${c.name}"`).join(", ")
  : `"To Reply", "FYI", "Awaiting Reply", "Actioned"`;
`- Emails are categorized as ${categoryList}. Users can create custom categories conversationally.`
```

---

## Files to Modify

- `prisma/schema.prisma` -- add `Category` model, add `categoryId` to relevant models
- `src/server/features/ai/tools/create.ts` -- add category creation support
- `src/server/features/ai/system-prompt.ts` -- dynamic category list

## Files to Create

- `prisma/migrations/<timestamp>_add_dynamic_categories/migration.sql` (auto-generated)
- `src/server/features/categories/resolve.ts` -- category resolution helper

## Testing Instructions

1. Apply migration: `bunx prisma migrate dev`
2. Verify TypeScript compiles: `bunx tsc --noEmit`
3. Verify default categories are created for existing users
4. Create a custom category via AI: "create a category called 'Client Work'"
5. Verify the category appears in the database
6. Run tests: `bunx vitest run`

## Rollback Plan

Drop the `Category` table. The existing `SystemType` enum continues to work.

## Dependencies on Other Issues

- **Issue 21** (configurable system prompt): Categories are part of the prompt configuration.
- **Issue 30** (flexible action composition): Related pattern of replacing fixed enums with dynamic alternatives.
