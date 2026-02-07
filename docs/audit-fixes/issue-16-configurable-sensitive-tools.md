# Issue 16: Make Approval Requirements User-Configurable

**Severity:** HIGH
**Category:** Workflow Fragmentation

---

## Problem

The list of tools requiring approval is hardcoded in two places:

**`src/server/features/channels/executor.ts`** (line 66):
```typescript
const sensitiveTools = ["modify", "delete", "send"];
```

**`src/server/features/web-chat/ai/chat.ts`** (line 227):
```typescript
const sensitiveTools = ["modify", "delete", "send"] as const;
```

Users cannot customize which actions need approval. A power user might want: "Send emails to internal contacts without asking, but ask me for external ones." A cautious user might want: "Ask me before doing anything."

---

## Root Cause

Approval logic was implemented as a simple list of tool names with no per-user configuration.

---

## Step-by-Step Fix

### Step 1: Add an `ApprovalPreference` model to the schema

**File:** `prisma/schema.prisma`

Add a new model to store per-user approval preferences:

```prisma
model ApprovalPreference {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  userId String
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Which tool this preference applies to
  toolName String  // "modify", "delete", "send", "create", "workflow"

  // The approval policy
  policy   String  // "always" | "never" | "conditional"

  // Optional conditions (JSON) -- e.g., { "externalOnly": true, "domains": ["@company.com"] }
  conditions Json?

  @@unique([userId, toolName])
  @@index([userId])
}
```

Add the reverse relation to User:

```prisma
model User {
  // ... existing fields ...
  approvalPreferences ApprovalPreference[]
}
```

### Step 2: Create the migration

```bash
bunx prisma migrate dev --name add_approval_preferences
```

### Step 3: Seed default preferences for existing users

In the migration SQL or a seed script, create default rows for existing users:

```sql
INSERT INTO "ApprovalPreference" (id, "userId", "toolName", policy, "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  u.id,
  tool.name,
  'always',
  NOW(),
  NOW()
FROM "User" u
CROSS JOIN (VALUES ('modify'), ('delete'), ('send')) AS tool(name)
ON CONFLICT DO NOTHING;
```

### Step 4: Create an approval policy checker

**File:** `src/server/features/approvals/policy.ts` (NEW FILE)

```typescript
import prisma from "@/server/db/client";

export type ApprovalPolicy = "always" | "never" | "conditional";

interface ApprovalConditions {
  externalOnly?: boolean;
  domains?: string[];
}

/**
 * Check whether a tool call requires approval for a given user.
 * Returns true if approval is required.
 */
export async function requiresApproval({
  userId,
  toolName,
  args,
}: {
  userId: string;
  toolName: string;
  args?: Record<string, unknown>;
}): Promise<boolean> {
  const pref = await prisma.approvalPreference.findUnique({
    where: { userId_toolName: { userId, toolName } },
  });

  // No preference set -- default to requiring approval for sensitive tools
  if (!pref) {
    const defaultSensitive = ["modify", "delete", "send"];
    return defaultSensitive.includes(toolName);
  }

  if (pref.policy === "always") return true;
  if (pref.policy === "never") return false;

  // Conditional logic
  if (pref.policy === "conditional" && pref.conditions) {
    const conditions = pref.conditions as ApprovalConditions;

    // Example: only require approval for external recipients
    if (conditions.externalOnly && conditions.domains?.length) {
      const recipients = (args?.to as string[]) || [];
      const isExternal = recipients.some(
        (email) => !conditions.domains!.some((domain) => email.endsWith(domain))
      );
      return isExternal; // Only require approval for external emails
    }
  }

  return true; // Default to requiring approval if conditions aren't met
}
```

### Step 5: Replace hardcoded sensitive tools in `executor.ts`

**File:** `src/server/features/channels/executor.ts`

Find the sensitive tools wrapping loop (around lines 66-110). Replace:

```typescript
// Before:
const sensitiveTools = ["modify", "delete", "send"];

for (const name of sensitiveTools) {
  const toolName = name as keyof typeof baseTools;
  const originalTool = baseTools[toolName];
  if (originalTool) {
    tools[toolName] = tool({
      // ... wrapping logic ...
    });
  }
}
```

**With:**

```typescript
import { requiresApproval } from "@/features/approvals/policy";

// All tools that COULD require approval
const potentiallyRestrictedTools = ["modify", "delete", "send", "create", "workflow"];

for (const name of potentiallyRestrictedTools) {
  const toolName = name as keyof typeof baseTools;
  const originalTool = baseTools[toolName];
  if (originalTool) {
    const originalExecute = (originalTool as { execute: Function }).execute;
    tools[toolName] = tool({
      description: originalTool.description,
      parameters: (originalTool as any).parameters,
      execute: async (args: any) => {
        const needsApproval = await requiresApproval({
          userId: user.id,
          toolName: name,
          args,
        });

        if (!needsApproval) {
          return originalExecute(args);
        }

        // ... existing approval creation logic (unchanged) ...
      },
    } as any);
  }
}
```

### Step 6: Do the same in `chat.ts`

**File:** `src/server/features/web-chat/ai/chat.ts`

Apply the same change as Step 5, replacing the hardcoded `sensitiveTools` list with the `requiresApproval` check.

### Step 7: Add an AI tool for managing approval preferences

**File:** `src/server/features/ai/tools/modify.ts`

In the `preferences` case (added in Issue 08), add handling for approval preferences:

```typescript
// Approval preferences
if ("approvalPolicy" in changes) {
  const { toolName, policy, conditions } = changes.approvalPolicy as {
    toolName: string;
    policy: string;
    conditions?: Record<string, unknown>;
  };
  await prisma.approvalPreference.upsert({
    where: { userId_toolName: { userId, toolName } },
    update: { policy, conditions: conditions ?? undefined },
    create: { userId, toolName, policy, conditions: conditions ?? undefined },
  });
  return { success: true, message: `Approval policy for "${toolName}" set to "${policy}".` };
}
```

### Step 8: Update system prompt with approval preference instructions

**File:** `src/server/features/ai/system-prompt.ts`

Add:

```
## Approval Preferences
Users can configure which actions require approval. When a user says "don't ask me before sending emails to my team" or "always ask before deleting anything", use the modify tool with resource "preferences" and changes.approvalPolicy to update their settings.
```

---

## Files to Modify

- `prisma/schema.prisma` -- add `ApprovalPreference` model
- `src/server/features/channels/executor.ts` -- replace hardcoded list with policy checker
- `src/server/features/web-chat/ai/chat.ts` -- replace hardcoded list with policy checker
- `src/server/features/ai/tools/modify.ts` -- add approval preference management
- `src/server/features/ai/system-prompt.ts` -- add guidance

## Files to Create

- `prisma/migrations/<timestamp>_add_approval_preferences/migration.sql` (auto-generated)
- `src/server/features/approvals/policy.ts` -- approval policy checker

## Testing Instructions

1. Apply migration: `bunx prisma migrate dev`
2. Verify TypeScript compiles: `bunx tsc --noEmit`
3. Test: set a preference via AI ("don't ask me before sending emails"), then send an email and verify it goes through without approval
4. Test: with default preferences, verify `modify` and `send` still require approval
5. Run tests: `bunx vitest run`

## Rollback Plan

Drop the `ApprovalPreference` table via a new migration. Revert code to use hardcoded list.

## Dependencies on Other Issues

- **Issue 08** (settings via AI): The preferences management UI leverages the same `modify(preferences)` tool.
- **Issue 15** (draft-and-send): The draft-and-send flow should check approval preferences.
- **Issue 17** (unify pipelines): Should be implemented after or alongside pipeline unification to avoid duplicating the policy check in two places.
