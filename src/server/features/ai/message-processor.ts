/**
 * Unified message processor — skills-only.
 *
 * This project now routes every user turn through the Skills Runtime. There is
 * no legacy LLM tool-calling loop, no canary/shadow modes, and no fallback path.
 *
 * Important: we still keep a lightweight orchestration preflight to avoid
 * unnecessary skill routing/tool work on purely conversational turns.
 */

import type { ModelMessage } from "ai";
import { createHash } from "crypto";
import prisma from "@/server/db/client";
import { ConversationService } from "@/features/conversations/service";
import { PrivacyService } from "@/features/privacy/service";
import { MemoryRecordingService } from "@/features/memory/service";
import type { Logger } from "@/server/lib/logger";
import { runBaselineSkillTurn } from "@/features/ai/skills/runtime";
import { runOrchestrationPreflight } from "@/server/features/ai/orchestration/preflight";
import { createGenerateText } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";

export interface ProcessorContext {
  conversationId?: string;
  channelId?: string;
  provider: string; // "slack" | "discord" | "telegram" | "web"
  teamId?: string;
  userId?: string; // Provider-specific user ID (not Amodel userId)
  messageId?: string;
  threadId?: string;
}

export interface MessageProcessorInput {
  /** Amodel user */
  user: { id: string };
  /** Resolved email account (with `.account.provider` when available) */
  emailAccount: {
    id: string;
    email: string;
    userId: string;
    about?: string | null;
    account?: { provider?: string };
    [key: string]: unknown;
  };

  // Message input — exactly one of these is set
  message?: string; // For surfaces (single message)
  messages?: ModelMessage[]; // For web (array incl. history)
  history?: Array<{ role: "user" | "assistant"; content: string }>; // Unused in skills runtime (kept for interface compatibility)

  context: ProcessorContext;

  // Kept for interface compatibility; skills runtime is non-streaming.
  streaming: boolean;

  logger: Logger;
}

export interface MessageProcessorResult {
  text: string;
  approvals: unknown[];
  interactivePayloads: unknown[];
  /** Only set when `streaming: true` */
  stream?: unknown;
}

type SourceEmailContext = {
  messageId?: string;
  threadId?: string;
  eventId?: string;
};

async function resolveSourceEmailContext({
  userId,
  emailAccountId,
  providerMessageId,
  providerThreadId,
}: {
  userId: string;
  emailAccountId: string;
  providerMessageId?: string;
  providerThreadId?: string;
}): Promise<SourceEmailContext> {
  const select = { messageId: true, threadId: true } as const;
  let eventIdFromMetadata: string | undefined;

  if (providerMessageId || providerThreadId) {
    const recentNotifications = await prisma.inAppNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { metadata: true },
    });

    for (const notification of recentNotifications) {
      const metadata =
        notification.metadata && typeof notification.metadata === "object"
          ? (notification.metadata as Record<string, unknown>)
          : null;
      if (!metadata) continue;

      const metadataMessageId =
        typeof metadata.messageId === "string" ? metadata.messageId : undefined;
      const metadataThreadId =
        typeof metadata.threadId === "string" ? metadata.threadId : undefined;
      const metadataEventId =
        typeof metadata.eventId === "string" ? metadata.eventId : undefined;

      const isMatch =
        (providerMessageId && metadataMessageId === providerMessageId) ||
        (providerThreadId && metadataThreadId === providerThreadId);
      if (!isMatch) continue;

      if (metadataEventId) {
        eventIdFromMetadata = metadataEventId;
      }

      const resolved = await prisma.emailMessage.findFirst({
        where: {
          emailAccountId,
          OR: [
            ...(metadataMessageId ? [{ messageId: metadataMessageId }] : []),
            ...(metadataThreadId ? [{ threadId: metadataThreadId }] : []),
          ],
        },
        orderBy: { date: "desc" },
        select,
      });
      if (resolved) {
        return {
          messageId: resolved.messageId,
          threadId: resolved.threadId,
          ...(eventIdFromMetadata ? { eventId: eventIdFromMetadata } : {}),
        };
      }
    }
  }

  if (providerMessageId) {
    const byMessage = await prisma.emailMessage.findFirst({
      where: {
        emailAccountId,
        OR: [{ id: providerMessageId }, { messageId: providerMessageId }],
      },
      select,
    });
    if (byMessage) {
      return {
        messageId: byMessage.messageId,
        threadId: byMessage.threadId,
        ...(eventIdFromMetadata ? { eventId: eventIdFromMetadata } : {}),
      };
    }
  }

  if (providerThreadId) {
    const byThread = await prisma.emailMessage.findFirst({
      where: { emailAccountId, threadId: providerThreadId },
      orderBy: { date: "desc" },
      select,
    });
    if (byThread) {
      return {
        messageId: byThread.messageId,
        threadId: byThread.threadId,
        ...(eventIdFromMetadata ? { eventId: eventIdFromMetadata } : {}),
      };
    }
  }

  if (!providerMessageId && !providerThreadId) {
    return {};
  }
  return eventIdFromMetadata ? { eventId: eventIdFromMetadata } : {};
}

function extractLatestUserMessage(messages: ModelMessage[]): string {
  const last = messages.filter((m) => m.role === "user").pop();
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  if (Array.isArray(last.content)) {
    return last.content
      .filter(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "text",
      )
      .map((part) => part.text)
      .join(" ");
  }
  return "";
}

async function persistAssistantMessage(
  userId: string,
  conversationId: string,
  text: string,
  provider: string,
  logger: Logger,
  channelId?: string,
  threadId?: string,
  anchorSeed?: string,
  toolCalls?: unknown,
): Promise<void> {
  const shouldRecord = await PrivacyService.shouldRecord(userId);
  if (!shouldRecord) return;

  const anchor = anchorSeed ?? `${Date.now()}`;
  const dedupeKey = createHash("sha256")
    .update(`${provider}:${conversationId}:${anchor}:assistant:${text.slice(0, 100)}`)
    .digest("hex");

  try {
    await prisma.conversationMessage.upsert({
      where: { dedupeKey },
      update: {},
      create: {
        userId,
        conversationId,
        role: "assistant",
        content: text,
        toolCalls: toolCalls ?? undefined,
        provider,
        dedupeKey,
        channelId: channelId ?? null,
        threadId: threadId ?? null,
        providerMessageId: null,
      },
    });
  } catch (e) {
    logger.error("Failed to persist assistant response", { error: e });
  }
}

function triggerMemoryRecording(userId: string, email: string, logger: Logger): void {
  (async () => {
    try {
      if (await MemoryRecordingService.shouldRecord(userId)) {
        await MemoryRecordingService.enqueueMemoryRecording(userId, email);
      }
    } catch (e) {
      logger.warn("Memory recording trigger failed", { error: e });
    }
  })();
}

function isTrivialAck(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return true;
  return /^(ok|okay|cool|nice|thanks|thank you|thx|got it|sounds good|👍)$/iu.test(normalized);
}

async function generateConversationalReply(params: {
  emailAccount: { id: string; email: string; userId: string };
  message: string;
  logger: Logger;
}): Promise<string> {
  if (isTrivialAck(params.message)) {
    return "Got it.";
  }

  const modelOptions = getModel("economy");
  const generateText = createGenerateText({
    emailAccount: params.emailAccount,
    label: "conversational-preflight-reply",
    modelOptions,
  });

  const result = await generateText({
    model: modelOptions.model,
    system:
      "You are Amodel. Be concise and helpful. If the user is not asking to check or change real inbox/calendar state, answer conversationally without mentioning tools.",
    prompt: params.message.trim(),
  });

  return result.text.trim() || "How can I help?";
}

export async function processMessage(
  input: MessageProcessorInput,
): Promise<MessageProcessorResult> {
  const { user, emailAccount, context, logger } = input;

  const conversationId = context.conversationId
    ? context.conversationId
    : (await ConversationService.getPrimaryWebConversation(user.id)).id;

  const messageContent =
    input.message ?? extractLatestUserMessage(input.messages ?? []);

  const resolvedProvider =
    (emailAccount as Record<string, unknown>).provider as string | undefined ??
    emailAccount.account?.provider;

  if (!resolvedProvider) {
    const text =
      "Your email account isn't fully connected. Please connect Gmail or Outlook in the Amodel web app, then try again.";
    return { text, approvals: [], interactivePayloads: [] };
  }

  // Orchestration preflight: avoid the skills runtime (router/slots/executor)
  // for conversational turns to reduce latency and LLM/tool costs.
  const preflight = await runOrchestrationPreflight({
    message: messageContent,
    provider: context.provider,
    userId: user.id,
    emailAccount: { id: emailAccount.id, email: emailAccount.email, userId: user.id },
    hasPendingApproval: false,
    hasPendingScheduleProposal: false,
  });

  if (!preflight.needsTools) {
    const text = await generateConversationalReply({
      emailAccount: { id: emailAccount.id, email: emailAccount.email, userId: user.id },
      message: messageContent,
      logger,
    });

    await persistAssistantMessage(
      user.id,
      conversationId,
      text,
      context.provider,
      logger,
      context.channelId,
      context.threadId,
      context.messageId ?? context.threadId ?? messageContent,
    );

    triggerMemoryRecording(user.id, emailAccount.email, logger);

    return { text, approvals: [], interactivePayloads: [] };
  }

  const sourceEmailContext = await resolveSourceEmailContext({
    userId: user.id,
    emailAccountId: emailAccount.id,
    providerMessageId: context.messageId,
    providerThreadId: context.threadId,
  });

  const skillsResult = await runBaselineSkillTurn({
    provider: context.provider,
    userId: user.id,
    emailAccountId: emailAccount.id,
    email: emailAccount.email,
    providerName: resolvedProvider,
    message: messageContent,
    logger,
    conversationId,
    sourceEmailMessageId: sourceEmailContext.messageId,
    sourceEmailThreadId: sourceEmailContext.threadId,
    sourceCalendarEventId: sourceEmailContext.eventId,
  });

  const text = skillsResult.text ?? "";
  const interactivePayloads =
    skillsResult.kind === "executed" ? skillsResult.interactivePayloads : [];

  // Persist assistant message for all providers, respecting PrivacyService.
  await persistAssistantMessage(
    user.id,
    conversationId,
    text,
    context.provider,
    logger,
    context.channelId,
    context.threadId,
    context.messageId ?? context.threadId ?? messageContent,
    // For now: store interactive payloads only (no free-form tool call logs).
    interactivePayloads.length > 0 ? { interactivePayloads } : undefined,
  );

  triggerMemoryRecording(user.id, emailAccount.email, logger);

  return { text, approvals: [], interactivePayloads };
}
