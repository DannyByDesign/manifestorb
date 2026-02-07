# Issue 21: Make System Prompt Constraints User-Configurable

**Severity:** MEDIUM
**Category:** Hardcoded Business Logic

---

## Problem

`src/server/features/ai/system-prompt.ts` contains hardcoded constraints that apply to ALL users:

- **Line 97:** `"Sending email requires explicit user approval for each message"` -- hardcoded for all users
- **Line 98:** `"Rule management does NOT require approval"` -- hardcoded exception
- **Line 118:** `"budget of steps (max 10)"` -- hardcoded step limit
- **Lines 135-140:** Conversation status categories hardcoded (`"To Reply"`, `"FYI"`, `"Awaiting Reply"`, `"Actioned"`)

Power users might want different step limits, different approval rules, or different conversation categories.

---

## Root Cause

System prompt was written as a static template. No mechanism exists to inject per-user configuration.

---

## Step-by-Step Fix

### Step 1: Add a `UserAIConfig` model

**File:** `prisma/schema.prisma`

```prisma
model UserAIConfig {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  userId String @unique
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Customizable prompt constraints
  maxSteps            Int?     // Default: 20 (null = use default)
  approvalInstructions String? // Custom approval rules (null = use default)
  customInstructions   String? // Additional user-specific instructions appended to prompt
  conversationCategories String[] // Custom categories (empty = use defaults)
}
```

### Step 2: Create the migration

```bash
bunx prisma migrate dev --name add_user_ai_config
```

### Step 3: Update `buildAgentSystemPrompt` to accept user config

**File:** `src/server/features/ai/system-prompt.ts`

Change the function signature to accept per-user overrides:

```typescript
export interface SystemPromptOptions {
  platform?: string;
  emailSendEnabled?: boolean;
  // NEW: per-user overrides
  userConfig?: {
    maxSteps?: number;
    approvalInstructions?: string;
    customInstructions?: string;
    conversationCategories?: string[];
  };
}

export function buildAgentSystemPrompt(options: SystemPromptOptions): string {
  const { platform, emailSendEnabled, userConfig } = options;
  const maxSteps = userConfig?.maxSteps ?? 20;
```

### Step 4: Replace hardcoded values with configurable ones

**File:** `src/server/features/ai/system-prompt.ts`

Replace each hardcoded value:

**Step budget (line 118):**
```typescript
// Before:
`- You have a budget of steps (max 10) - use them efficiently.`
// After:
`- You have a budget of steps (max ${maxSteps}) - use them efficiently.`
```

**Approval rules (lines 97-98):**
```typescript
// Before:
`- Sending email requires explicit user approval for each message (in-app or verbal).`
`- Rule management does NOT require approval - users can review rules in settings.`

// After:
const approvalBlock = userConfig?.approvalInstructions
  ?? `- Sending email requires explicit user approval for each message (in-app or verbal).
- Rule management does NOT require approval - users can review rules in settings.`;
// Use approvalBlock in the prompt template
```

**Conversation categories (lines 135-140):**
```typescript
// Before:
`- Emails are automatically categorized as "To Reply", "FYI", "Awaiting Reply", or "Actioned".`

// After:
const categories = userConfig?.conversationCategories?.length
  ? userConfig.conversationCategories.map(c => `"${c}"`).join(", ")
  : `"To Reply", "FYI", "Awaiting Reply", "Actioned"`;
`- Emails are automatically categorized as ${categories}.`
```

**Custom instructions:**
```typescript
// At the end of the prompt:
const customBlock = userConfig?.customInstructions
  ? `\n## User-Specific Instructions\n${userConfig.customInstructions}\n`
  : "";
// Append customBlock to the final prompt string
```

### Step 5: Load user config before building the prompt

**File:** `src/server/features/channels/executor.ts`

Before the `buildAgentSystemPrompt` call (around line 185), load the user's config:

```typescript
const userAiConfig = await prisma.userAIConfig.findUnique({
  where: { userId: user.id },
  select: {
    maxSteps: true,
    approvalInstructions: true,
    customInstructions: true,
    conversationCategories: true,
  },
});

const baseSystemPrompt = buildAgentSystemPrompt({
  platform: context.provider as Platform,
  emailSendEnabled: false,
  userConfig: userAiConfig ?? undefined,
});
```

Do the same in `chat.ts` (or in the unified `message-processor.ts` from Issue 17).

### Step 6: Also pass `maxSteps` to the LLM call

**File:** `src/server/features/channels/executor.ts` and `src/server/features/web-chat/ai/chat.ts`

```typescript
const maxSteps = userAiConfig?.maxSteps ?? 20;

// In the generate/stream call:
maxSteps: maxSteps,
```

### Step 7: Add AI tool for managing AI config

**File:** `src/server/features/ai/tools/modify.ts`

In the `preferences` case, add AI config management:

```typescript
if ("aiConfig" in changes) {
  const config = changes.aiConfig as Record<string, unknown>;
  await prisma.userAIConfig.upsert({
    where: { userId },
    update: {
      ...(config.maxSteps !== undefined ? { maxSteps: Number(config.maxSteps) } : {}),
      ...(config.customInstructions !== undefined ? { customInstructions: String(config.customInstructions) } : {}),
      ...(config.approvalInstructions !== undefined ? { approvalInstructions: String(config.approvalInstructions) } : {}),
    },
    create: {
      userId,
      ...(config.maxSteps !== undefined ? { maxSteps: Number(config.maxSteps) } : {}),
      ...(config.customInstructions !== undefined ? { customInstructions: String(config.customInstructions) } : {}),
    },
  });
  return { success: true, message: "AI configuration updated." };
}
```

---

## Files to Modify

- `prisma/schema.prisma` -- add `UserAIConfig` model
- `src/server/features/ai/system-prompt.ts` -- accept userConfig, replace hardcoded values
- `src/server/features/channels/executor.ts` -- load and pass user config
- `src/server/features/web-chat/ai/chat.ts` -- load and pass user config
- `src/server/features/ai/tools/modify.ts` -- add AI config management

## Files to Create

- `prisma/migrations/<timestamp>_add_user_ai_config/migration.sql` (auto-generated)

## Testing Instructions

1. Apply migration: `bunx prisma migrate dev`
2. Verify TypeScript compiles: `bunx tsc --noEmit`
3. Create a `UserAIConfig` with `maxSteps: 5` and verify the AI stops after 5 steps
4. Set `customInstructions: "Always be extremely concise"` and verify the AI changes behavior
5. Run tests: `bunx vitest run`

## Rollback Plan

Drop the `UserAIConfig` table and revert to hardcoded values.

## Dependencies on Other Issues

- **Issue 16** (configurable approvals): Approval instructions in the prompt should align with the approval policy checker.
- **Issue 17** (unify pipelines): Config loading should happen once in the unified pipeline.
