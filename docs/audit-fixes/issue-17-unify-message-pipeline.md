# Issue 17: Unify executor.ts and chat.ts into Single Message Pipeline

**Severity:** HIGH
**Category:** Workflow Fragmentation

---

## Problem

Two separate implementations process user messages:

1. **`src/server/features/channels/executor.ts`** (`runOneShotAgent`) -- for Slack, Discord, Telegram
   - Uses `createGenerateText()` (non-streaming)
   - Accepts a single `message: string`
   - Has thread context injection via `InAppNotification` lookup
   - Returns `{ text, approvals, interactivePayloads }`

2. **`src/server/features/web-chat/ai/chat.ts`** (`aiProcessAssistantChat`) -- for web UI
   - Uses `chatCompletionStream()` (streaming)
   - Accepts `ModelMessage[]` array
   - Has `fix-rule` hidden context support
   - Persists user message before LLM call
   - Returns a stream

Both files share ~80% of the same logic:
- Build context pack via `ContextManager.buildContextPack()`
- Construct system prompt via `buildAgentSystemPrompt()`
- Create tools via `createAgentTools()`
- Wrap sensitive tools with approval interceptor
- Add pending state and memory tools
- Persist messages and trigger memory recording

Any fix or improvement must be applied in both places, which is error-prone.

---

## Root Cause

The surface-based executor and web chat were built by different contributors at different times. No abstraction layer was created to share logic.

---

## Step-by-Step Fix

### Step 1: Create a unified message processor

**File:** `src/server/features/ai/message-processor.ts` (NEW FILE)

Create a shared abstraction that both entry points call:

```typescript
import type { User, EmailAccount } from "@/generated/prisma/client";
import type { ModelMessage } from "ai";

export interface MessageProcessorInput {
  user: User;
  emailAccount: EmailAccount;

  // Message input -- either a single string or array of messages
  message?: string;        // For surfaces (single message)
  messages?: ModelMessage[]; // For web (message array)

  // Context
  context: {
    conversationId?: string;
    channelId?: string;
    provider: string;    // "slack" | "discord" | "telegram" | "web"
    teamId?: string;
    userId?: string;     // Provider-specific user ID
    messageId?: string;
    threadId?: string;
  };

  // Options
  streaming: boolean;     // true for web, false for surfaces
  hiddenContext?: {       // For fix-rule context in web
    type: string;
    content: string;
  };

  logger: Logger;
}

export interface MessageProcessorResult {
  text: string;
  approvals: unknown[];
  interactivePayloads: unknown[];
  stream?: ReadableStream; // Only when streaming=true
}
```

### Step 2: Extract shared logic into the processor

**File:** `src/server/features/ai/message-processor.ts`

```typescript
export async function processMessage(input: MessageProcessorInput): Promise<MessageProcessorResult> {
  const { user, emailAccount, context, streaming, logger } = input;

  // 1. Setup tools (shared)
  const baseTools = await createAgentTools({
    emailAccount,
    logger,
    userId: user.id,
  });

  const memoryTools = createMemoryTools({
    userId: user.id,
    email: emailAccount.email,
    logger,
  });

  // 2. Wrap sensitive tools with approval (shared)
  const approvalService = new ApprovalService(prisma);
  const tools = await wrapToolsWithApproval({
    baseTools: { ...baseTools, ...memoryTools },
    userId: user.id,
    context,
    approvalService,
    logger,
  });

  // 3. Build context pack (shared)
  const conversation = context.conversationId
    ? { id: context.conversationId }
    : await ConversationService.getPrimaryWebConversation(user.id);

  const messageContent = input.message
    ?? extractLatestUserMessage(input.messages ?? []);

  const contextPack = await ContextManager.buildContextPack({
    user,
    emailAccount,
    messageContent,
    conversationId: conversation.id,
  });

  // 4. Build system prompt (shared)
  const systemPrompt = buildFullSystemPrompt({
    platform: context.provider,
    contextPack,
    threadContext: await getThreadContext(user.id, context),
    hiddenContext: input.hiddenContext,
  });

  // 5. Build messages array (shared)
  const finalMessages = buildMessageArray({
    systemPrompt,
    message: input.message,
    messages: input.messages,
    history: contextPack.history,
  });

  // 6. Execute LLM (branching point)
  if (streaming) {
    const stream = chatCompletionStream({
      userEmail: emailAccount.email,
      modelType: "chat",
      usageLabel: `chat-${context.provider}`,
      messages: finalMessages,
      maxSteps: 20,
      tools,
      onFinish: async ({ text }) => {
        await persistAssistantMessage(user.id, conversation.id, text, context.provider, logger);
        await triggerMemoryRecording(user.id, emailAccount.email, logger);
      },
    });
    return { text: "", approvals: [], interactivePayloads: [], stream };
  } else {
    const result = await createGenerateText({ ... })({
      model: modelOptions.model,
      tools,
      maxSteps: 20,
      messages: finalMessages,
    });
    const responseText = result.text?.trim() ?? "";
    await persistAssistantMessage(user.id, conversation.id, responseText, context.provider, logger);
    await triggerMemoryRecording(user.id, emailAccount.email, logger);
    return {
      text: responseText,
      approvals: [],
      interactivePayloads: extractInteractivePayloads(result),
    };
  }
}
```

### Step 3: Extract helper functions

**File:** `src/server/features/ai/message-processor.ts`

Extract these as private helper functions within the same file:

- `wrapToolsWithApproval()` -- the shared tool wrapping logic
- `buildFullSystemPrompt()` -- combines base prompt + context pack + pending state + thread context
- `buildMessageArray()` -- constructs the final messages array
- `persistAssistantMessage()` -- saves to database
- `triggerMemoryRecording()` -- fire-and-forget memory recording
- `extractInteractivePayloads()` -- parses tool results for interactive elements
- `getThreadContext()` -- the notification-based thread context lookup
- `extractLatestUserMessage()` -- extracts text from ModelMessage array

### Step 4: Refactor `executor.ts` to use the processor

**File:** `src/server/features/channels/executor.ts`

Replace the entire body of `runOneShotAgent` with a call to `processMessage`:

```typescript
export async function runOneShotAgent({ user, emailAccount, message, context }) {
  const result = await processMessage({
    user,
    emailAccount,
    message,
    context: {
      conversationId: context.conversationId,
      channelId: context.channelId,
      provider: context.provider,
      teamId: context.teamId,
      userId: context.userId,
      messageId: context.messageId,
      threadId: context.threadId,
    },
    streaming: false,
    logger,
  });

  return {
    text: result.text,
    approvals: result.approvals,
    interactivePayloads: result.interactivePayloads,
  };
}
```

### Step 5: Refactor `chat.ts` to use the processor

**File:** `src/server/features/web-chat/ai/chat.ts`

Replace the body of `aiProcessAssistantChat`:

```typescript
export async function aiProcessAssistantChat({ messages, emailAccountId, user, context, logger }) {
  const emailAccount = await resolveEmailAccount(user.id, emailAccountId);

  const result = await processMessage({
    user: { id: user.id } as User,
    emailAccount,
    messages,
    context: {
      provider: "web",
      ...(context?.type === "fix-rule" ? {} : {}),
    },
    streaming: true,
    hiddenContext: context?.type === "fix-rule" ? {
      type: "fix-rule",
      content: buildFixRuleContext(context),
    } : undefined,
    logger,
  });

  return result.stream;
}
```

### Step 6: Delete duplicated code

After verifying both entry points work through the unified processor, delete the duplicated logic from both `executor.ts` and `chat.ts`. Each file should be < 50 lines -- just a thin adapter calling `processMessage`.

---

## Files to Modify

- `src/server/features/channels/executor.ts` -- thin wrapper calling processMessage
- `src/server/features/web-chat/ai/chat.ts` -- thin wrapper calling processMessage

## Files to Create

- `src/server/features/ai/message-processor.ts` -- unified message processing pipeline

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Run the E2E test: `bunx vitest run src/__tests__/e2e/`
3. Test web chat manually -- verify streaming works
4. Test via a surface (Slack/Discord/Telegram) -- verify non-streaming works
5. Run all existing tests: `bunx vitest run`

## Rollback Plan

Delete `message-processor.ts` and revert `executor.ts` and `chat.ts` to their previous implementations.

## Dependencies on Other Issues

- **Issue 16** (configurable approvals): The unified pipeline should include the policy checker in one place.
- **Issue 15** (draft-and-send): The draft-and-send approval logic goes into the unified pipeline.
- **Issue 12** (enrich context pack): Domain objects are added to `buildContextPack()` once, consumed by the unified pipeline.
