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
import { ApprovalService } from "@/features/approvals/service";
import { executeApprovalRequest } from "@/features/approvals/execute";
import { resolveScheduleProposalRequestById } from "@/features/calendar/schedule-proposal";
import { resolveAmbiguousTimeRequestById } from "@/features/calendar/ambiguous-time";

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

type DecisionIntent = "APPROVE" | "DENY";

type PendingDecisionCandidate = {
  id: string;
  provider: string;
  createdAt: Date;
  score: number;
  actionType?: string;
  requestPayload: Record<string, unknown>;
  externalContext: Record<string, unknown>;
};

type PendingDecisionContext = {
  hasPendingApproval: boolean;
  hasPendingScheduleProposal: boolean;
  primary: PendingDecisionCandidate | null;
  pendingApproval: PendingDecisionCandidate | null;
  pendingScheduleProposal: PendingDecisionCandidate | null;
  pendingAmbiguousTime: PendingDecisionCandidate | null;
};

const APPROVE_REPLY_PATTERN =
  /^(yes|yep|yeah|approve|approved|go ahead|send it|do it|confirm)$/iu;
const DENY_REPLY_PATTERN =
  /^(no|nope|nah|deny|denied|cancel|stop|don't|dont|do not)$/iu;

const OPTION_WORD_TO_INDEX: Record<string, number> = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
  fifth: 4,
  sixth: 5,
  seventh: 6,
  eighth: 7,
  ninth: 8,
  tenth: 9,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function getStringFromAnyKey(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function detectDecisionIntent(message: string): DecisionIntent | null {
  const normalized = message.trim().toLowerCase().replace(/[!?.,]/gu, "");
  if (!normalized) return null;

  if (APPROVE_REPLY_PATTERN.test(normalized)) return "APPROVE";
  if (DENY_REPLY_PATTERN.test(normalized)) return "DENY";
  return null;
}

function parseScheduleChoiceIndex(
  message: string,
  optionsCount: number,
): number | null {
  if (optionsCount <= 0) return null;
  const normalized = message.trim().toLowerCase();
  if (!normalized) return null;

  const directNumber = normalized.match(/^(\d{1,2})$/u);
  if (directNumber) {
    const parsed = Number.parseInt(directNumber[1], 10);
    if (parsed >= 1 && parsed <= optionsCount) return parsed - 1;
  }

  const optionNumber = normalized.match(/\b(?:option|slot|choice)\s*(\d{1,2})\b/u);
  if (optionNumber) {
    const parsed = Number.parseInt(optionNumber[1], 10);
    if (parsed >= 1 && parsed <= optionsCount) return parsed - 1;
  }

  for (const [word, index] of Object.entries(OPTION_WORD_TO_INDEX)) {
    if (index >= optionsCount) continue;
    if (new RegExp(`\\b${word}\\b`, "u").test(normalized)) {
      return index;
    }
  }
  return null;
}

function parseAmbiguousTimeChoice(
  message: string,
): "earlier" | "later" | null {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return null;
  const hasEarlier = /\bearlier\b/u.test(normalized);
  const hasLater = /\blater\b/u.test(normalized);
  if (hasEarlier && !hasLater) return "earlier";
  if (hasLater && !hasEarlier) return "later";
  return null;
}

function formatScheduleOptionLabel(option: {
  start: string;
  end?: string;
  timeZone?: string;
}): string {
  const timeZone = option.timeZone || "UTC";
  const startDate = new Date(option.start);
  if (Number.isNaN(startDate.getTime())) return option.start;

  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  });
  const startLabel = formatter.format(startDate);
  if (!option.end) return startLabel;

  const endDate = new Date(option.end);
  if (Number.isNaN(endDate.getTime())) return startLabel;
  return `${startLabel} - ${formatter.format(endDate)}`;
}

function scorePendingCandidate(params: {
  candidate: PendingDecisionCandidate;
  context: ProcessorContext;
  conversationId: string;
}): number {
  const { candidate, context, conversationId } = params;
  const payload = candidate.requestPayload;
  const external = candidate.externalContext;
  let score = 0;

  if (candidate.provider === context.provider) score += 2;

  const payloadConversationId = getStringFromAnyKey(payload, ["conversationId"]);
  const externalConversationId = getStringFromAnyKey(external, ["conversationId"]);
  if (
    conversationId &&
    (payloadConversationId === conversationId ||
      externalConversationId === conversationId)
  ) {
    score += 8;
  }

  const contextThread = context.threadId?.trim();
  if (contextThread) {
    const payloadThread = getStringFromAnyKey(payload, [
      "threadId",
      "threadTs",
      "thread_ts",
    ]);
    const externalThread = getStringFromAnyKey(external, [
      "threadId",
      "threadTs",
      "thread_ts",
      "messageThreadId",
    ]);
    if (payloadThread === contextThread || externalThread === contextThread) {
      score += 10;
    }
  }

  const contextMessage = context.messageId?.trim();
  if (contextMessage) {
    const payloadMessage = getStringFromAnyKey(payload, [
      "messageId",
      "providerMessageId",
      "messageTs",
      "message_ts",
    ]);
    const externalMessage = getStringFromAnyKey(external, [
      "messageId",
      "providerMessageId",
      "messageTs",
      "message_ts",
    ]);
    if (
      payloadMessage === contextMessage ||
      externalMessage === contextMessage
    ) {
      score += 6;
    }
  }

  const contextChannel = context.channelId?.trim();
  if (contextChannel) {
    const externalChannel = getStringFromAnyKey(external, [
      "channelId",
      "channel",
      "channel_id",
    ]);
    if (externalChannel === contextChannel) {
      score += 5;
    }
  }

  const contextTeam = context.teamId?.trim();
  if (contextTeam) {
    const externalTeam = getStringFromAnyKey(external, [
      "workspaceId",
      "teamId",
      "workspace_id",
    ]);
    if (externalTeam === contextTeam) {
      score += 3;
    }
  }

  return score;
}

async function resolvePendingDecisionContext(params: {
  userId: string;
  conversationId: string;
  context: ProcessorContext;
}): Promise<PendingDecisionContext> {
  const rows = await prisma.approvalRequest.findMany({
    where: {
      userId: params.userId,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      provider: true,
      requestPayload: true,
      externalContext: true,
      createdAt: true,
    },
  });

  if (rows.length === 0) {
    return {
      hasPendingApproval: false,
      hasPendingScheduleProposal: false,
      primary: null,
      pendingApproval: null,
      pendingScheduleProposal: null,
      pendingAmbiguousTime: null,
    };
  }

  const candidates = rows.map((row) => {
    const requestPayload = asRecord(row.requestPayload);
    const externalContext = asRecord(row.externalContext);
    const actionType =
      typeof requestPayload.actionType === "string"
        ? requestPayload.actionType
        : undefined;
    const candidate: PendingDecisionCandidate = {
      id: row.id,
      provider: row.provider,
      createdAt: row.createdAt,
      score: 0,
      actionType,
      requestPayload,
      externalContext,
    };
    return {
      ...candidate,
      score: scorePendingCandidate({
        candidate,
        context: params.context,
        conversationId: params.conversationId,
      }),
    };
  });

  const scopedCandidates = candidates.filter((candidate) => candidate.score > 0);
  const ranked = (scopedCandidates.length > 0 ? scopedCandidates : candidates).sort(
    (a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime(),
  );

  const pendingScheduleProposal =
    ranked.find((candidate) => candidate.actionType === "schedule_proposal") ??
    null;
  const pendingAmbiguousTime =
    ranked.find((candidate) => candidate.actionType === "ambiguous_time") ?? null;
  const pendingApproval =
    ranked.find((candidate) => candidate.actionType !== "schedule_proposal") ??
    null;

  return {
    hasPendingApproval: pendingApproval !== null,
    hasPendingScheduleProposal: pendingScheduleProposal !== null,
    primary: ranked[0] ?? null,
    pendingApproval,
    pendingScheduleProposal,
    pendingAmbiguousTime,
  };
}

function formatDecisionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = message.match(/Cannot decide on request in status: (\w+)/u);
  if (!statusMatch) return "I couldn't process that decision right now. Please try again.";

  const status = statusMatch[1];
  if (status === "EXPIRED") {
    return "That approval request expired. Please ask me to recreate it.";
  }
  if (status === "APPROVED" || status === "DENIED") {
    return "That request was already processed.";
  }
  return "I couldn't process that decision right now. Please try again.";
}

function buildApproveSuccessMessage(executionResult: unknown): string {
  if (executionResult && typeof executionResult === "object" && "toolName" in executionResult) {
    const toolName = (executionResult as { toolName?: unknown }).toolName;
    if (toolName === "send") return "Approved. I sent that message.";
    if (toolName === "create") return "Approved. I created that for you.";
    if (toolName === "modify") return "Approved. I applied the update.";
    if (toolName === "delete") return "Approved. I removed it.";
  }
  return "Approved. I completed the request.";
}

async function handlePendingDecisionTurn(params: {
  message: string;
  userId: string;
  pendingContext: PendingDecisionContext;
}): Promise<{ handled: true; text: string } | { handled: false }> {
  const { message, userId, pendingContext } = params;
  const decisionIntent = detectDecisionIntent(message);

  const scheduleCandidate = pendingContext.pendingScheduleProposal;
  if (scheduleCandidate) {
    const optionsRaw = scheduleCandidate.requestPayload.options;
    const options = Array.isArray(optionsRaw)
      ? optionsRaw.filter(
          (option): option is { start: string; end?: string; timeZone?: string } =>
            Boolean(option) &&
            typeof option === "object" &&
            typeof (option as Record<string, unknown>).start === "string",
        )
      : [];

    const choiceIndex = parseScheduleChoiceIndex(message, options.length);
    if (choiceIndex !== null) {
      const result = await resolveScheduleProposalRequestById({
        requestId: scheduleCandidate.id,
        choiceIndex,
        userId,
      });
      if (!result.ok) {
        return {
          handled: true,
          text:
            result.error === "Request expired"
              ? "That schedule proposal expired. Please ask me to recreate it."
              : result.error === "Request not found"
                ? "I couldn't find that pending schedule proposal."
                : "I couldn't apply that slot selection. Please try again.",
        };
      }

      const selectedOption = options[choiceIndex];
      const label = selectedOption
        ? formatScheduleOptionLabel(selectedOption)
        : `option ${choiceIndex + 1}`;
      return {
        handled: true,
        text: `Approved. I scheduled it for ${label}.`,
      };
    }
  }

  const ambiguousCandidate = pendingContext.pendingAmbiguousTime;
  if (ambiguousCandidate) {
    const ambiguousChoice = parseAmbiguousTimeChoice(message);
    if (ambiguousChoice) {
      const result = await resolveAmbiguousTimeRequestById({
        requestId: ambiguousCandidate.id,
        choice: ambiguousChoice,
        userId,
      });
      if (!result.ok) {
        return {
          handled: true,
          text:
            result.error === "Request expired"
              ? "That request expired. Please ask me to recreate it."
              : result.error === "Request not found"
                ? "I couldn't find that pending request."
                : "I couldn't apply that time choice. Please try again.",
        };
      }

      return {
        handled: true,
        text:
          ambiguousChoice === "earlier"
            ? "Approved. I used the earlier time and applied it."
            : "Approved. I used the later time and applied it.",
      };
    }
  }

  if (!decisionIntent) return { handled: false };

  const target = pendingContext.primary;
  if (!target) return { handled: false };

  if (target.actionType === "schedule_proposal") {
    if (decisionIntent === "DENY") {
      try {
        const service = new ApprovalService(prisma);
        await service.decideRequest({
          approvalRequestId: target.id,
          decidedByUserId: userId,
          decision: "DENY",
          reason: "Denied by user in conversation",
        });
        return {
          handled: true,
          text: "Denied. I canceled that scheduling proposal.",
        };
      } catch (error) {
        return { handled: true, text: formatDecisionError(error) };
      }
    }

    const optionsRaw = target.requestPayload.options;
    const optionsCount = Array.isArray(optionsRaw) ? optionsRaw.length : 0;
    return {
      handled: true,
      text:
        optionsCount > 0
          ? `I still need a slot selection. Reply with an option number from 1 to ${optionsCount}.`
          : "I still need a slot selection, but no options are available. Please ask me to recreate the proposal.",
    };
  }

  if (target.actionType === "ambiguous_time") {
    if (decisionIntent === "DENY") {
      try {
        const service = new ApprovalService(prisma);
        await service.decideRequest({
          approvalRequestId: target.id,
          decidedByUserId: userId,
          decision: "DENY",
          reason: "Denied by user in conversation",
        });
        return {
          handled: true,
          text: "Denied. I canceled that request.",
        };
      } catch (error) {
        return { handled: true, text: formatDecisionError(error) };
      }
    }

    return {
      handled: true,
      text: 'I need a specific choice. Reply with either "earlier" or "later."',
    };
  }

  if (decisionIntent === "DENY") {
    try {
      const service = new ApprovalService(prisma);
      await service.decideRequest({
        approvalRequestId: target.id,
        decidedByUserId: userId,
        decision: "DENY",
        reason: "Denied by user in conversation",
      });
      return {
        handled: true,
        text: "Denied. I canceled that request.",
      };
    } catch (error) {
      return { handled: true, text: formatDecisionError(error) };
    }
  }

  try {
    const execution = await executeApprovalRequest({
      approvalRequestId: target.id,
      decidedByUserId: userId,
      reason: "Approved by user in conversation",
    });
    return {
      handled: true,
      text: buildApproveSuccessMessage(execution),
    };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    if (messageText.includes("Schedule proposals require an explicit slot selection")) {
      return {
        handled: true,
        text: "I need a slot selection first. Reply with an option number (for example: 1).",
      };
    }
    if (messageText.includes("Ambiguous-time approvals require selecting earlier/later")) {
      return {
        handled: true,
        text: 'I need a specific time choice. Reply with either "earlier" or "later."',
      };
    }
    return { handled: true, text: formatDecisionError(error) };
  }
}

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

  const pendingContext = await resolvePendingDecisionContext({
    userId: user.id,
    conversationId,
    context,
  });

  const pendingDecisionResult = await handlePendingDecisionTurn({
    message: messageContent,
    userId: user.id,
    pendingContext,
  });

  if (pendingDecisionResult.handled) {
    await persistAssistantMessage(
      user.id,
      conversationId,
      pendingDecisionResult.text,
      context.provider,
      logger,
      context.channelId,
      context.threadId,
      context.messageId ?? context.threadId ?? messageContent,
    );

    triggerMemoryRecording(user.id, emailAccount.email, logger);
    return { text: pendingDecisionResult.text, approvals: [], interactivePayloads: [] };
  }

  // Orchestration preflight: avoid the skills runtime (router/slots/executor)
  // for conversational turns to reduce latency and LLM/tool costs.
  const preflight = await runOrchestrationPreflight({
    message: messageContent,
    provider: context.provider,
    userId: user.id,
    emailAccount: { id: emailAccount.id, email: emailAccount.email, userId: user.id },
    hasPendingApproval: pendingContext.hasPendingApproval,
    hasPendingScheduleProposal: pendingContext.hasPendingScheduleProposal,
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
    channelId: context.channelId,
    threadId: context.threadId,
    messageId: context.messageId,
    teamId: context.teamId,
    sourceEmailMessageId: sourceEmailContext.messageId,
    sourceEmailThreadId: sourceEmailContext.threadId,
    sourceCalendarEventId: sourceEmailContext.eventId,
  });

  const text = skillsResult.text ?? "";
  const interactivePayloads =
    skillsResult.kind === "executed" ? skillsResult.interactivePayloads : [];
  const approvals = skillsResult.kind === "executed" ? skillsResult.approvals : [];

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
    interactivePayloads.length > 0 || approvals.length > 0
      ? { interactivePayloads, approvals }
      : undefined,
  );

  triggerMemoryRecording(user.id, emailAccount.email, logger);

  return { text, approvals, interactivePayloads };
}
