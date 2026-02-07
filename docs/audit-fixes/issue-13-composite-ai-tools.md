# Issue 13: Add Cross-Resource Tool Orchestration

**Severity:** MEDIUM
**Category:** Feature Siloing

---

## Problem

Each AI tool (`create.ts`, `modify.ts`, `query.ts`, `delete.ts`) handles one resource type per call. There is no orchestration for multi-resource workflows. The AI must make multiple sequential tool calls for common workflows like:

- "Create a task from this email and block time on my calendar" (3 calls: query email, create task, create calendar event)
- "Draft a reply to Sarah and schedule a follow-up meeting" (2 calls: create email draft, create calendar event)

The AI has a hardcoded step budget of 10 (line 118 of `system-prompt.ts`), which limits multi-step orchestration.

---

## Root Cause

Tools were designed as single-resource CRUD operations. No composite tool exists for common cross-feature patterns.

---

## Step-by-Step Fix

### Step 1: Increase the step budget

**File:** `src/server/features/ai/system-prompt.ts`

Find line 118:

```typescript
- You have a budget of steps (max 10) - use them efficiently.
```

Change to:

```typescript
- You have a budget of steps (max 20) - use them efficiently. Prefer combining related actions in fewer steps.
```

Also update the `maxSteps` parameter where the LLM is called:

**File:** `src/server/features/channels/executor.ts` (around line 254):

```typescript
// Before:
maxSteps: 10,
// After:
maxSteps: 20,
```

**File:** `src/server/features/web-chat/ai/chat.ts` (around line 340):

```typescript
// Before:
maxSteps: 10,
// After:
maxSteps: 20,
```

### Step 2: Create a `workflow` composite tool

**File:** `src/server/features/ai/tools/workflow.ts` (NEW FILE)

Create a new tool that accepts a sequence of operations to execute atomically:

```typescript
import { z } from "zod";
import type { ToolDefinition } from "./types";

const workflowStep = z.object({
  action: z.enum(["create", "modify", "query", "delete"]),
  resource: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  ids: z.array(z.string()).optional(),
  changes: z.record(z.string(), z.unknown()).optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
  // Reference a previous step's output
  dependsOn: z.number().optional().describe("0-based index of a previous step whose output should be available as context"),
});

export const workflowTool: ToolDefinition<z.infer<typeof workflowParameters>> = {
  name: "workflow",
  description: `Execute a multi-step workflow atomically. Use this when you need to perform related actions across different resources in a single step.

Example workflows:
- Create a task from an email: [{ action: "create", resource: "task", data: { title: "...", sourceEmailMessageId: "..." } }, { action: "create", resource: "calendar", data: { title: "Work on: ...", autoSchedule: true } }]
- Reply to email and create follow-up task: [{ action: "create", resource: "email", data: { ... } }, { action: "create", resource: "task", data: { ... } }]

Each step runs sequentially. If a step fails, subsequent steps are skipped and the error is returned along with results of successful steps.`,

  parameters: z.object({
    steps: z.array(workflowStep).min(2).max(5).describe("Array of steps to execute in order"),
  }),

  execute: async ({ steps }, context) => {
    const results: Array<{ step: number; success: boolean; data?: unknown; error?: string }> = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      try {
        // Delegate to existing tool handlers
        const toolModule = await import(`./${step.action}`);
        const tool = toolModule.default || toolModule[`${step.action}Tool`];

        const args = {
          resource: step.resource,
          ...(step.data ? { data: step.data } : {}),
          ...(step.ids ? { ids: step.ids } : {}),
          ...(step.changes ? { changes: step.changes } : {}),
          ...(step.filter ? { filter: step.filter } : {}),
        };

        const result = await tool.execute(args, context);
        results.push({ step: i, success: true, data: result });
      } catch (error) {
        results.push({
          step: i,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        break; // Stop on failure
      }
    }

    return {
      success: results.every(r => r.success),
      data: results,
      message: `Executed ${results.filter(r => r.success).length}/${steps.length} steps.`,
    };
  },
};
```

### Step 3: Register the workflow tool

**File:** `src/server/features/ai/tools/index.ts` (or wherever tools are aggregated)

Find where tools are combined and add the workflow tool:

```typescript
import { workflowTool } from "./workflow";

// ... in the tool registration ...
workflow: workflowTool,
```

### Step 4: Add workflow examples to system prompt

**File:** `src/server/features/ai/system-prompt.ts`

Add a section about the workflow tool:

```typescript
## Multi-Step Workflows
When the user's request involves multiple related actions across different resources (e.g., "create a task from this email and block time"), use the "workflow" tool to execute them atomically in a single step rather than making multiple separate tool calls.
```

---

## Files to Modify

- `src/server/features/ai/system-prompt.ts` -- increase step budget, add workflow guidance
- `src/server/features/channels/executor.ts` -- increase `maxSteps`
- `src/server/features/web-chat/ai/chat.ts` -- increase `maxSteps`
- `src/server/features/ai/tools/index.ts` -- register workflow tool

## Files to Create

- `src/server/features/ai/tools/workflow.ts` -- composite workflow tool

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Test via AI: "create a task called 'Review proposal' and block 30 minutes on my calendar for it"
3. Verify both the task and calendar event are created
4. Test error handling: submit a workflow where the second step references a non-existent resource

## Rollback Plan

Delete the new workflow tool file and revert the modified files. Existing single-resource tools continue to work.

## Dependencies on Other Issues

- **Issue 10** (cross-feature FKs): The workflow tool can populate cross-feature fields when creating linked resources.
- **Issue 21** (configurable system prompt): Step budget should ultimately be user-configurable.
