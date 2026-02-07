# Issue 09: Route Server Actions Through AI Tools

**Severity:** MEDIUM
**Category:** Dashboard/UI-Centric Architecture

---

## Problem

Approximately 20 server actions in `src/server/actions/` are structured as form submission handlers with Zod validation schemas. When called from UI components, they bypass the AI entirely:

- `src/server/actions/rule.ts`: `createRuleAction`, `updateRuleAction`, `deleteRuleAction`, `toggleRuleAction`, `toggleAllRulesAction`, `enableDraftRepliesAction`, etc.
- `src/server/actions/mail.ts`: `archiveThreadAction`, `trashThreadAction`, `markReadThreadAction`, `createAutoArchiveFilterAction`, `sendEmailAction`, etc.
- `src/server/actions/group.ts`: `createGroupAction`, `addGroupItemAction`, `deleteGroupItemAction`
- `src/server/actions/knowledge.ts`: `createKnowledgeAction`, `updateKnowledgeAction`, `deleteKnowledgeAction`

These server actions are fine as an **implementation layer**, but the primary user path should be through AI tools. Currently, the AI tools and server actions are disconnected -- the AI has its own tools (create, modify, query, delete) that sometimes duplicate the server action logic.

---

## Root Cause

Server actions were built for Next.js form submissions. The AI tool layer was added later and doesn't always call through to the same server actions, leading to duplicated logic.

---

## Step-by-Step Fix

### Step 1: Audit which server actions already have AI tool equivalents

Map each server action to its AI tool equivalent:

| Server Action | AI Tool Equivalent | Status |
|---|---|---|
| `archiveThreadAction` | `modify(email, {archive: true})` | Already covered |
| `trashThreadAction` | `modify(email, {trash: true})` | Already covered |
| `markReadThreadAction` | `modify(email, {read: true})` | Already covered |
| `sendEmailAction` | `create(email)` + `send` tool | Already covered |
| `createRuleAction` | `create(automation)` | Partially covered |
| `updateRuleAction` | `modify(automation)` | Partially covered |
| `deleteRuleAction` | `delete(automation)` | Partially covered |
| `createKnowledgeAction` | `create(knowledge)` | Already covered |
| `updateKnowledgeAction` | `modify(knowledge)` | Check if implemented |
| `deleteKnowledgeAction` | `delete(knowledge)` | Check if implemented |
| `createGroupAction` | No equivalent | **Gap** |
| `addGroupItemAction` | No equivalent | **Gap** |
| `createAutoArchiveFilterAction` | No equivalent | **Gap** |
| `toggleRuleAction` | No equivalent | **Gap** |
| `toggleDigestAction` | See Issue 08 | **Gap** |

### Step 2: Add missing AI tool handlers for rules

**File:** `src/server/features/ai/tools/modify.ts`

Ensure the `automation` case in the modify tool handles rule toggling:

```typescript
case "automation": {
  if (!ids?.length) {
    return { success: false, error: "Rule ID required" };
  }
  const ruleId = ids[0];

  // Toggle rule enabled/disabled
  if ("enabled" in changes) {
    await prisma.rule.update({
      where: { id: ruleId },
      data: { enabled: Boolean(changes.enabled) },
    });
    return { success: true, message: `Rule ${changes.enabled ? "enabled" : "disabled"}.` };
  }

  // Update rule instructions
  if ("instructions" in changes) {
    await prisma.rule.update({
      where: { id: ruleId },
      data: { instructions: changes.instructions as string },
    });
    return { success: true, message: "Rule instructions updated." };
  }

  // ... existing modification logic ...
}
```

### Step 3: Add group management to AI tools

**File:** `src/server/features/ai/tools/create.ts`

If `automation` resource handling doesn't already support group creation, add it. Groups are related to rules (they define sender groups for rule conditions).

In the `automation` case of the create tool:

```typescript
// If data contains "group" fields, create a group
if (data.type === "group" || data.groupName) {
  const { createGroupAction } = await import("@/server/actions/group");
  // Requires a ruleId -- the AI should reference the rule
  if (!data.ruleId) {
    return { success: false, error: "Group creation requires a ruleId" };
  }
  const result = await createGroupAction({ ruleId: data.ruleId as string });
  return { success: true, data: result };
}
```

### Step 4: Ensure server actions are called from AI tool handlers where possible

For each AI tool handler that duplicates server action logic, refactor to call through to the server action instead. This ensures consistent validation and side effects.

Example -- in the delete tool's `knowledge` handler, instead of directly calling Prisma:

```typescript
// Before (direct Prisma call):
await prisma.knowledge.delete({ where: { id: knowledgeId } });

// After (call through server action):
const { deleteKnowledgeAction } = await import("@/server/actions/knowledge");
await deleteKnowledgeAction({ id: knowledgeId });
```

### Step 5: Document the mapping

Add a comment at the top of each AI tool file listing which server actions it wraps:

```typescript
/**
 * AI Tool: modify
 *
 * Wraps server actions:
 * - email: archiveThreadAction, trashThreadAction, markReadThreadAction
 * - automation: updateRuleAction, toggleRuleAction
 * - preferences: updateDigestScheduleAction, toggleDigestAction, updateEmailSettingsAction
 * - knowledge: updateKnowledgeAction
 */
```

---

## Files to Modify

- `src/server/features/ai/tools/modify.ts` -- extend automation handler, call through to server actions
- `src/server/features/ai/tools/create.ts` -- add group creation support
- `src/server/features/ai/tools/delete.ts` -- call through to server actions

## Files to Create

None.

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Test via AI: "disable my urgent email rule", "create a new knowledge entry about my work schedule"
3. Run existing tests: `bunx vitest run src/server/features/ai/tools/`

## Rollback Plan

Revert modified files. Server actions and AI tools continue to work independently.

## Dependencies on Other Issues

- **Issue 08** (settings via AI): This issue covers the general pattern; Issue 08 is the specific case for settings.
- **Issue 16** (configurable approvals): Some server actions should require approval when called via AI.
