/**
 * Agent Executor for External Chat Platforms
 *
 * Thin adapter that delegates to the unified message processor.
 * Handles Slack, Discord, and Telegram messages (non-streaming).
 */
import { processMessage } from "@/features/ai/message-processor";
import { createScopedLogger } from "@/server/lib/logger";
import prisma from "@/server/db/client";
import type { EmailAccount, User } from "@/generated/prisma/client";
import type { InteractivePayload } from "@/features/channels/types";
import type { ModelMessage } from "ai";

const logger = createScopedLogger("AgentExecutor");

function normalizeHistoryMessages(
  history?: Array<{ role: "system" | "user" | "assistant"; content: unknown }>,
): ModelMessage[] | undefined {
  if (!Array.isArray(history) || history.length === 0) return undefined;
  const normalized: ModelMessage[] = [];
  for (const message of history) {
    if (!message || typeof message !== "object") continue;
    if (
      message.role !== "system" &&
      message.role !== "user" &&
      message.role !== "assistant"
    ) {
      continue;
    }
    if (typeof message.content === "string") {
      normalized.push({
        role: message.role,
        content: message.content,
      });
      continue;
    }
    if (Array.isArray(message.content)) {
      const textParts = message.content
        .filter(
          (part): part is { type: "text"; text: string } =>
            Boolean(part) &&
            typeof part === "object" &&
            "type" in part &&
            (part as { type?: unknown }).type === "text" &&
            "text" in part &&
            typeof (part as { text?: unknown }).text === "string",
        )
        .map((part) => ({ type: "text" as const, text: part.text }));
      if (textParts.length > 0) {
        normalized.push(
          {
            role: message.role,
            content: textParts,
          } as ModelMessage,
        );
      }
    }
  }
  return normalized.length > 0 ? normalized : undefined;
}

export async function runOneShotAgent({
  user,
  emailAccount,
  message,
  history,
  context,
}: {
  user: User;
  emailAccount: EmailAccount;
  message: string;
  history?: Array<{ role: "system" | "user" | "assistant"; content: unknown }>;
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
  // Look up the linked Account to get the provider (google / microsoft)
  const accountRow = await prisma.emailAccount.findUnique({
    where: { id: emailAccount.id },
    select: { account: { select: { provider: true } } },
  });

  const result = await processMessage({
    user: { id: user.id },
    emailAccount: {
      id: emailAccount.id,
      email: emailAccount.email,
      userId: user.id,
      account: accountRow?.account,
    },
    message,
    messages: normalizeHistoryMessages(history),
    context: {
      conversationId: context.conversationId,
      channelId: context.channelId,
      provider: context.provider,
      teamId: context.teamId,
      userId: context.userId,
      messageId: context.messageId,
      threadId: context.threadId,
    },
    logger,
  });

  const interactivePayloads = Array.isArray(result.interactivePayloads)
    ? (result.interactivePayloads as unknown[]).filter(
        (payload): payload is InteractivePayload =>
          Boolean(payload) &&
          typeof payload === "object" &&
          "type" in (payload as Record<string, unknown>),
      )
    : [];

  return {
    text: result.text,
    approvals: Array.isArray(result.approvals)
      ? (result.approvals as Array<{ id?: unknown; requestPayload?: unknown }>).filter(
          (item): item is { id: string; requestPayload?: unknown } =>
            Boolean(item) && typeof item.id === "string" && item.id.length > 0,
        )
      : [],
    interactivePayloads,
  };
}
