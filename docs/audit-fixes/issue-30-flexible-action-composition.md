# Issue 30: Replace Rigid ActionType Enum with Flexible Action Composition

**Severity:** LOW
**Category:** Enum & Schema Design

---

## Problem

The `ActionType` enum in `prisma/schema.prisma` (lines 1238-1261) has a fixed set of 17 action types:

```prisma
enum ActionType {
  ARCHIVE
  LABEL
  REPLY
  SEND_EMAIL
  FORWARD
  DRAFT_EMAIL
  MARK_SPAM
  CALL_WEBHOOK
  MARK_READ
  DIGEST
  MOVE_FOLDER
  NOTIFY_SENDER
  NOTIFY_USER
  SET_TASK_PREFERENCES
  CREATE_TASK
  CREATE_CALENDAR_EVENT
  SCHEDULE_MEETING
}
```

Adding a new composite action (like `SCHEDULE_MEETING`) requires:
1. Schema migration to add the enum value
2. Update `src/server/lib/action-item.ts` (`actionInputs` map + `sanitizeActionFields` switch)
3. Update `src/server/features/ai/actions.ts` (implement the action function)
4. Update `src/server/features/rules/ai/prompts/create-rule-schema.ts` (add to available actions)
5. Update `src/server/features/rules/ai/prompts/prompt-to-rules.ts` (add guidance and examples)

This 5-file change for every new action type is rigid and error-prone.

---

## Root Cause

Actions were designed as a flat enum where each type has a dedicated code path. No composition or dynamic action registration exists.

---

## Step-by-Step Fix

### Important Note

Fully replacing the ActionType enum is a large refactor. This plan takes an incremental approach: keep the enum for existing actions, add a flexible action registration system alongside it, and gradually migrate.

### Step 1: Create an action registry

**File:** `src/server/features/ai/actions/registry.ts` (NEW FILE)

```typescript
import type { ActionFunction } from "../actions";

interface ActionDefinition {
  type: string;
  name: string;
  description: string;
  /** Fields this action accepts (for sanitizeActionFields) */
  inputFields: string[];
  /** The implementation function */
  execute: ActionFunction<Record<string, unknown>>;
  /** Whether this action should appear in prompt-to-rules suggestions */
  availableForRules: boolean;
  /** Natural language patterns that should trigger this action */
  triggerPatterns: string[];
}

const registry = new Map<string, ActionDefinition>();

/**
 * Register a new action type. Can be called at module load time.
 */
export function registerAction(definition: ActionDefinition): void {
  if (registry.has(definition.type)) {
    throw new Error(`Action type "${definition.type}" is already registered`);
  }
  registry.set(definition.type, definition);
}

/**
 * Get an action definition by type.
 */
export function getAction(type: string): ActionDefinition | undefined {
  return registry.get(type);
}

/**
 * Get all registered actions.
 */
export function getAllActions(): ActionDefinition[] {
  return Array.from(registry.values());
}

/**
 * Get actions available for rule creation.
 */
export function getRuleActions(): ActionDefinition[] {
  return getAllActions().filter(a => a.availableForRules);
}

/**
 * Get action trigger patterns for prompt-to-rules guidance.
 */
export function getActionTriggerGuidance(): string {
  return getRuleActions()
    .map(a => `- ${a.type}: ${a.description}. Trigger patterns: ${a.triggerPatterns.join(", ")}`)
    .join("\n");
}
```

### Step 2: Register existing actions

**File:** `src/server/features/ai/actions/register-defaults.ts` (NEW FILE)

```typescript
import { registerAction } from "./registry";
// Import existing action implementations from actions.ts

// Example: Register SCHEDULE_MEETING
registerAction({
  type: "SCHEDULE_MEETING",
  name: "Schedule Meeting",
  description: "Finds available calendar slots, creates a draft reply, and sends an approval notification",
  inputFields: [], // No specific input fields needed
  execute: async (opts) => {
    const { schedule_meeting } = await import("../actions");
    return schedule_meeting(opts);
  },
  availableForRules: true,
  triggerPatterns: [
    "when someone asks to meet",
    "when someone wants to schedule",
    "when a meeting request comes in",
    "find times and draft a reply",
  ],
});

// Register other actions similarly...
registerAction({
  type: "NOTIFY_USER",
  name: "Notify User",
  description: "Send a push notification to the user about the matching email",
  inputFields: [],
  execute: async (opts) => {
    const { notify_user } = await import("../actions");
    return notify_user(opts);
  },
  availableForRules: true,
  triggerPatterns: [
    "notify me when",
    "alert me about",
    "let me know when",
  ],
});

// ... repeat for all ActionType values
```

### Step 3: Update `runActionFunction` to check the registry

**File:** `src/server/features/ai/actions.ts`

Add a fallback to the registry at the end of the switch statement:

```typescript
export async function runActionFunction(
  type: ActionType | string, // Accept string for registry-based actions
  opts: ActionFunctionOptions,
): Promise<void> {
  // First, check the existing switch for backward compatibility
  switch (type) {
    case ActionType.ARCHIVE:
      return archive(opts);
    // ... existing cases ...

    default: {
      // Check the registry for dynamically registered actions
      const { getAction } = await import("./actions/registry");
      const registeredAction = getAction(type);
      if (registeredAction) {
        return registeredAction.execute(opts);
      }
      throw new Error(`Unknown action type: ${type}`);
    }
  }
}
```

### Step 4: Update `sanitizeActionFields` to use the registry

**File:** `src/server/lib/action-item.ts`

Add a fallback:

```typescript
default: {
  const { getAction } = await import("@/features/ai/actions/registry");
  const registeredAction = getAction(action.type);
  if (registeredAction) {
    // Return base fields plus any registered input fields
    const filtered: Record<string, unknown> = { ...base };
    for (const field of registeredAction.inputFields) {
      if (field in action) {
        filtered[field] = (action as Record<string, unknown>)[field];
      }
    }
    return filtered;
  }
  return base; // Unknown type, return base only
}
```

### Step 5: Update prompt-to-rules to use registry guidance

**File:** `src/server/features/rules/ai/prompts/prompt-to-rules.ts`

Replace hardcoded action guidance with dynamic guidance from the registry:

```typescript
import { getActionTriggerGuidance } from "@/features/ai/actions/registry";

// In the system prompt for prompt-to-rules:
const actionGuidance = getActionTriggerGuidance();
// Include actionGuidance in the prompt instead of hardcoded examples
```

### Step 6: Update `getAvailableActions` in create-rule-schema

**File:** `src/server/features/rules/ai/prompts/create-rule-schema.ts`

```typescript
import { getRuleActions } from "@/features/ai/actions/registry";

export function getAvailableActions(): string[] {
  // Merge enum values with registry-based actions
  const enumActions = Object.values(ActionType);
  const registryActions = getRuleActions().map(a => a.type);
  return [...new Set([...enumActions, ...registryActions])];
}
```

---

## Files to Modify

- `src/server/features/ai/actions.ts` -- add registry fallback in switch
- `src/server/lib/action-item.ts` -- add registry fallback in sanitize
- `src/server/features/rules/ai/prompts/prompt-to-rules.ts` -- use registry guidance
- `src/server/features/rules/ai/prompts/create-rule-schema.ts` -- merge registry actions

## Files to Create

- `src/server/features/ai/actions/registry.ts` -- action registration system
- `src/server/features/ai/actions/register-defaults.ts` -- register existing actions

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Verify all existing actions still work through the switch statement
3. Register a test action via the registry and verify it executes
4. Verify prompt-to-rules picks up registered actions
5. Run tests: `bunx vitest run`

## Rollback Plan

Delete the registry files and remove the fallback checks. The existing enum-based switch continues to work.

## Dependencies on Other Issues

- **Issue 29** (dynamic categories): Same pattern of replacing fixed enums with dynamic alternatives.
- **Issue 01** (remove heuristics): After the registry is in place, new actions can be added without heuristic code.

## Future Work

Once all actions are registered in the registry:
1. The `ActionType` enum can be deprecated (kept in schema for data but not in code)
2. New actions can be added by creating a single file that calls `registerAction()`
3. Users could potentially define custom actions via the AI ("when I get an email from X, do Y and Z")
