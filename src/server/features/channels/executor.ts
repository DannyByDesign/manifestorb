/**
 * Agent Executor for External Chat Platforms
 *
 * Thin adapter that delegates to the unified message processor.
 * Handles Slack, Discord, and Telegram messages (non-streaming).
 */
import { processMessage } from "@/features/ai/message-processor";
import { createScopedLogger } from "@/server/lib/logger";
import type { EmailAccount, User } from "@/generated/prisma/client";

const logger = createScopedLogger("AgentExecutor");

export async function runOneShotAgent({
  user,
  emailAccount,
  message,
  context,
}: {
  user: User;
  emailAccount: EmailAccount;
  message: string;
  context: {
    conversationId: string;
    channelId: string;
    provider: string; // "slack" | "discord" | "telegram"
    teamId?: string;
    userId: string;
    messageId?: string;
    threadId?: string;
  };
}) {
  const result = await processMessage({
    user: { id: user.id },
    emailAccount: {
      id: emailAccount.id,
      email: emailAccount.email,
      userId: user.id,
    },
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
