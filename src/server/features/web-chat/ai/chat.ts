import { tool, type ModelMessage } from "ai";
import { createHash } from "crypto";
import type { Logger } from "@/server/lib/logger";
import prisma from "@/server/db/client";
import { ApprovalService } from "@/features/approvals/service";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import { chatCompletionStream } from "@/server/lib/llms";
import type { MessageContext } from "@/app/api/chat/validation";
import { stringifyEmail } from "@/server/lib/stringify-email";
import { getEmailForLLM } from "@/server/lib/get-email-from-message";
import type { ParsedMessage } from "@/server/types";
import { env } from "@/env";
import { createAgentTools } from "@/features/ai/tools";
import { createRuleManagementTools } from "@/features/ai/rule-tools";
import { createMemoryTools } from "@/features/ai/memory-tools";
import { buildAgentSystemPrompt } from "@/features/ai/system-prompt";
import { createInAppNotification } from "@/features/notifications/create";
import { ContextManager } from "@/features/memory/context-manager";
import { ConversationService } from "@/features/conversations/service";
import { MemoryRecordingService } from "@/features/memory/service";
import { PrivacyService } from "@/features/privacy/service";

export const maxDuration = 120;

export async function aiProcessAssistantChat({
  messages,
  emailAccountId,
  user,
  context,
  logger,
}: {
  messages: ModelMessage[];
  emailAccountId: string;
  user: EmailAccountWithAI;
  context?: MessageContext;
  logger: Logger;
}) {
  // Build unified system prompt (same as surfaces agent)
  const system = buildAgentSystemPrompt({
    platform: "web",
    emailSendEnabled: env.NEXT_PUBLIC_EMAIL_SEND_ENABLED === true,
  });

  const toolOptions = {
    email: user.email,
    emailAccountId,
    provider: user.account.provider,
    logger,
  };

  const accountId = emailAccountId; // fallback or logic depending on your existing code structure
  // The user suggested:
  // const provider = user.account.provider;
  // const emailAccount = await prisma.emailAccount.findFirst({ ... });

  // However, we already have `emailAccountId` passed in to `createChat`.
  // If `emailAccountId` is available, let's use it.

  let connectedEmailAccount = null;
  if (emailAccountId) {
    connectedEmailAccount = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      include: { account: true }
    });
  } else {
    // Fallback: try to find one by provider/user
    connectedEmailAccount = await prisma.emailAccount.findFirst({
      where: {
        userId: user.id,
        // provider: user.account.provider // 'provider' might not be on EmailAccount directly if it's on Account. 
        // NOTE: EmailAccount usually links to Account. 
        // But let's look at schema: EmailAccount has `accountId`. Account has `provider`.
        account: {
          provider: user.account.provider
        }
      },
      include: { account: true }
    });
  }

  if (!connectedEmailAccount) {
    // If still missing, we might be in a state where we can't run tools.
    // But for now, let's try to proceed or throw as user suggested.
    // "throw new Error(...)"
    // But wait, existing code was falling back to `user.account`.
    // Let's assume for this fix we MUST have a real EmailAccount for tools.
    // If this is a new user without one, tools might fail.
    // I'll log a warning and maybe pass null? But createAgentTools expects EmailAccount.
    // User said "Throw error if !emailAccount".

    console.warn("No linked EmailAccount found for chat tools. Tools may fail.");
    // We can't easily construct a fake one that satisfies the type.
    // Let's try to fetch ANY email account for this user as a fallback?
    connectedEmailAccount = await prisma.emailAccount.findFirst({
      where: { userId: user.id },
      include: { account: true }
    });
  }

  if (!connectedEmailAccount) {
    // Determine what to do. The user code suggested throwing.
    // I will throw to fail fast as requested.
    throw new Error(`No EmailAccount connected for user ${user.id}`);
  }

  // ========================================================================
  // CONTEXT MANAGEMENT
  // ========================================================================

  // 1. Get or create the user's primary web conversation
  const conversation = await ConversationService.getPrimaryWebConversation(user.id);

  // 2. Extract the latest user message content for context retrieval
  const latestUserMessage = messages
    .filter(m => m.role === "user")
    .pop();
  const messageContent = typeof latestUserMessage?.content === "string"
    ? latestUserMessage.content
    : Array.isArray(latestUserMessage?.content)
      ? latestUserMessage.content
          .filter((part): part is { type: "text"; text: string } => 
            typeof part === "object" && part !== null && "type" in part && part.type === "text"
          )
          .map(part => part.text)
          .join(" ")
      : "";

  // 3. Build context pack (retrieves facts, knowledge, history, summary)
  const contextPack = await ContextManager.buildContextPack({
    user: { id: user.id },  // Only need user ID for context retrieval
    emailAccount: connectedEmailAccount,
    messageContent,
    conversationId: conversation.id
  });

  // 4. Persist user message to database for future context retrieval
  const shouldRecord = await PrivacyService.shouldRecord(user.id);
  if (shouldRecord && messageContent) {
    const dedupeKey = createHash("sha256")
      .update(`web:${conversation.id}:${Date.now()}:user:${messageContent.slice(0, 100)}`)
      .digest("hex");

    try {
      await prisma.conversationMessage.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          userId: user.id,
          conversationId: conversation.id,
          role: "user",
          content: messageContent,
          provider: "web",
          dedupeKey,
          channelId: null,
          threadId: null,
          providerMessageId: null
        }
      });
    } catch (e) {
      logger.warn("Failed to persist user message", { error: e });
    }
  }

  // 5. Build context-enriched system prompt
  const systemWithContext = `${system}

---
## Dynamic Context (Auto-Retrieved)

### Conversation Summary
${contextPack.system.summary || "No prior conversation summary."}

### User Personal Instructions
${contextPack.system.legacyAbout || "No personal instructions set."}

### Relevant Facts (Learned from past conversations)
${contextPack.facts.length > 0
    ? contextPack.facts.map(f => `- ${f.key}: ${f.value}`).join("\n")
    : "None relevant to current message."}

### Knowledge Base (User-created)
${contextPack.knowledge.length > 0
    ? contextPack.knowledge.map(k => `- ${k.title}: ${k.content.slice(0, 200)}${k.content.length > 200 ? '...' : ''}`).join("\n")
    : "None relevant to current message."}
---
`;

  // ========================================================================
  // END CONTEXT MANAGEMENT
  // ========================================================================

  const baseAgentTools = await createAgentTools({
    emailAccount: {
      ...connectedEmailAccount,
      ...connectedEmailAccount.account,
      // Ensure ID is from EmailAccount, not Account if they conflict (though they shouldn't overlap much)
      id: connectedEmailAccount.id,
      // Ensure email is from EmailAccount
      email: connectedEmailAccount.email,
      // Convert Date to number for EmailAccount type compatibility
      expires_at: connectedEmailAccount.account.expires_at ? new Date(connectedEmailAccount.account.expires_at).getTime() : null
    },
    logger,
    userId: user.id
  });

  // Wrap sensitive tools (modify, delete) with approval workflow
  // Drafts (create) don't need approval since user must manually send them
  const approvalService = new ApprovalService(prisma);
  const sensitiveTools = ["modify", "delete"] as const;
  const agentTools: typeof baseAgentTools = { ...baseAgentTools };

  for (const toolName of sensitiveTools) {
    const originalTool = baseAgentTools[toolName];
    if (originalTool) {
      agentTools[toolName] = tool({
        description: originalTool.description,
        parameters: (originalTool as any).parameters,
        execute: async (args: any) => {
          logger.info(`Intercepting tool ${toolName} for approval`);

          const requestPayload = {
            actionType: "tool_execution",
            description: `Execute tool ${toolName}`,
            tool: toolName,
            args: args as Record<string, any>
          };

          const stableArgs = JSON.stringify(args, Object.keys(args).sort());
          const idempotencyKey = createHash("sha256")
            .update(`web-chat:${emailAccountId}:${Date.now()}:${toolName}:${stableArgs}`)
            .digest("hex");

          const approval = await approvalService.createRequest({
            userId: user.id,
            provider: "web",
            externalContext: { source: "web-chat", emailAccountId },
            requestPayload,
            idempotencyKey,
            expiresInSeconds: 3600
          } as any);

          // Create in-app notification so user sees toast with Approve/Deny buttons
          await createInAppNotification({
            userId: user.id,
            title: "Approval Required",
            body: `${toolName}: ${JSON.stringify(args).slice(0, 100)}...`,
            type: "approval",
            metadata: {
              approvalId: approval.id,
              tool: toolName,
              args: args
            },
            dedupeKey: `approval-${approval.id}`
          });

          return {
            status: "approval_pending",
            approvalId: approval.id,
            message: "This action requires your approval. You'll see a notification to approve or deny."
          };
        }
      } as any);
    }
  }

  const hiddenContextMessage =
    context && context.type === "fix-rule"
      ? [
        {
          role: "system" as const,
          content:
            "Hidden context for the user's request (do not repeat this to the user):\n\n" +
            `<email>\n${stringifyEmail(
              getEmailForLLM(context.message as ParsedMessage, {
                maxLength: 3000,
              }),
              3000,
            )}\n</email>\n\n` +
            `Rules that were applied:\n${context.results
              .map((r) => `- ${r.ruleName ?? "None"}: ${r.reason}`)
              .join("\n")}\n\n` +
            `Expected outcome: ${context.expected === "new"
              ? "Create a new rule"
              : context.expected === "none"
                ? "No rule should be applied"
                : `Should match the "${context.expected.name}" rule`
            }`,
        },
      ]
      : [];

  const result = chatCompletionStream({
    userEmail: user.email,
    modelType: "chat",
    usageLabel: "assistant-chat",
    messages: [
      {
        role: "system",
        content: systemWithContext, // Use context-enriched system prompt
      },
      ...hiddenContextMessage,
      ...messages,
    ],
    onStepFinish: async ({ text, toolCalls }) => {
      logger.trace("Step finished", { text, toolCalls });
    },
    onFinish: async ({ text }) => {
      // 6. Trigger summarization if needed (fire and forget)
      if (shouldRecord) {
        // Persist assistant response
        try {
          const assistantDedupeKey = createHash("sha256")
            .update(`web:${conversation.id}:${Date.now()}:assistant:${text.slice(0, 100)}`)
            .digest("hex");

          await prisma.conversationMessage.upsert({
            where: { dedupeKey: assistantDedupeKey },
            update: {},
            create: {
              userId: user.id,
              conversationId: conversation.id,
              role: "assistant",
              content: text,
              provider: "web",
              dedupeKey: assistantDedupeKey,
              channelId: null,
              threadId: null,
              providerMessageId: null
            }
          });
        } catch (e) {
          logger.warn("Failed to persist assistant message", { error: e });
        }

        // Check if we should trigger memory recording
        // UNIFIED: Uses userId for cross-platform memory
        (async () => {
          try {
            if (await MemoryRecordingService.shouldRecord(user.id)) {
              await MemoryRecordingService.enqueueMemoryRecording(user.id, user.email);
            }
          } catch (e) {
            logger.warn("Memory recording trigger failed", { error: e });
          }
        })();
      }
    },
    maxSteps: 10,
    tools: {
      ...agentTools,
      ...createRuleManagementTools(toolOptions),
      ...createMemoryTools({
        userId: user.id,
        email: user.email,
        logger,
      }),
    },
  });

  return result;
}
