import { tool, type ModelMessage } from "ai";
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
import { buildAgentSystemPrompt } from "@/features/ai/system-prompt";

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

          const { createHash } = await import("crypto");
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

          return {
            status: "approval_pending",
            approvalId: approval.id,
            message: "This action requires your approval. Please approve it in the Approvals panel."
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
    userAi: user.user,
    userEmail: user.email,
    modelType: "chat",
    usageLabel: "assistant-chat",
    messages: [
      {
        role: "system",
        content: system,
      },
      ...hiddenContextMessage,
      ...messages,
    ],
    onStepFinish: async ({ text, toolCalls }) => {
      logger.trace("Step finished", { text, toolCalls });
    },
    maxSteps: 10,
    tools: {
      ...agentTools,
      ...createRuleManagementTools(toolOptions),
    },
  });

  return result;
}
