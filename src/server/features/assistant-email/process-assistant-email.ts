import { isDefined, type ParsedMessage } from "@/server/lib/types";
import type { Logger } from "@/server/lib/logger";
import { extractEmailAddress } from "@/server/lib/email";
import prisma from "@/server/db/client";
import { emailToContent } from "@/server/lib/mail";
import { isAssistantEmail } from "@/features/assistant-email/is-assistant-email";
import { internalDateToDate } from "@/server/lib/date";
import type { EmailProvider } from "@/features/email/types";
import { labelMessageAndSync } from "@/server/lib/label.server";
import { runOneShotAgent } from "@/features/channels/executor";
import { ConversationService } from "@/features/conversations/service";
import type { EmailAccount as PrismaEmailAccount } from "@/generated/prisma/client";

type ProcessAssistantEmailArgs = {
  emailAccountId: string;
  userEmail: string;
  message: ParsedMessage;
  provider: EmailProvider;
  logger: Logger;
};

export async function processAssistantEmail({
  emailAccountId,
  userEmail,
  message,
  provider,
  logger,
}: ProcessAssistantEmailArgs) {
  logger = logger.with({
    emailAccountId,
    threadId: message.threadId,
    messageId: message.id,
  });

  return withProcessingLabels(
    message.id,
    provider,
    emailAccountId,
    () =>
      processAssistantEmailInternal({
        emailAccountId,
        userEmail,
        message,
        provider,
        logger,
      }),
    logger,
  );
}

async function processAssistantEmailInternal({
  emailAccountId,
  userEmail,
  message,
  provider,
  logger,
}: ProcessAssistantEmailArgs & { logger: Logger }) {
  if (!verifyUserSentEmail({ message, userEmail })) {
    logger.error("Unauthorized assistant access attempt", {
      email: userEmail,
      from: message.headers.from,
      to: message.headers.to,
    });
    throw new Error("Unauthorized assistant access attempt");
  }

  logger.info("Processing assistant email");

  // 1. get thread
  // 2. get first message in thread to the personal assistant
  // 3. get the referenced message from that message

  const threadMessages = await provider.getThreadMessages(message.threadId);

  if (!threadMessages?.length) {
    logger.error("No thread messages found");
    await provider.replyToEmail(
      message,
      "Something went wrong. I couldn't read any messages.",
    );
    return;
  }

  const firstMessageToAssistant = threadMessages.find((m) =>
    isAssistantEmail({
      userEmail,
      emailToCheck: m.headers.to,
    }),
  );

  if (!firstMessageToAssistant) {
    logger.error("No first message to assistant found", {
      messageId: message.id,
    });
    await provider.replyToEmail(
      message,
      "Something went wrong. I couldn't find the first message to the personal assistant.",
    );
    return;
  }

  const originalMessageId = firstMessageToAssistant.headers["in-reply-to"];
  const originalMessage = await provider.getOriginalMessage(originalMessageId);

  const emailAccount = await prisma.emailAccount.findUnique({
    where: { email: userEmail },
    select: {
      id: true,
      userId: true,
      email: true,
      about: true,
      multiRuleSelectionEnabled: true,
      timezone: true,
      calendarBookingLink: true,
      account: { select: { provider: true } },
    },
  });

  if (!emailAccount) {
    logger.error("User not found");
    return;
  }

  const firstMessageToAssistantDate = internalDateToDate(
    firstMessageToAssistant.internalDate,
  );

  const messages = threadMessages
    .filter(
      (m) => internalDateToDate(m.internalDate) >= firstMessageToAssistantDate,
    )
    .map((m) => {
      const isAssistant = isAssistantEmail({
        userEmail,
        emailToCheck: m.headers.from,
      });
      const isFirstMessageToAssistant = m.id === firstMessageToAssistant.id;

      let content = "";

      // use subject if first message
      if (isFirstMessageToAssistant && !originalMessage) {
        content += `Subject: ${m.headers.subject}\n\n`;
      }

      content += emailToContent(m, {
        extractReply: true,
        removeForwarded: isFirstMessageToAssistant,
      });

      return {
        role: isAssistant ? "assistant" : "user",
        content,
      } as const;
    });

  if (messages[messages.length - 1].role === "assistant") {
    logger.error("Assistant message cannot be last");
    return;
  }

  // Get the user object
  const user = await prisma.user.findUnique({
    where: { id: emailAccount.userId },
  });

  if (!user) {
    logger.error("User not found");
    return;
  }

  // Build emailAccount with provider field for runOneShotAgent
  const linkedAccount = emailAccount.account as { provider?: string } | null;
  const providerValue = linkedAccount?.provider;
  if (!providerValue) {
    logger.error("Email account has no linked provider");
    return;
  }

  // runOneShotAgent only needs `id` and `email` (it looks up provider internally),
  // but its signature expects a Prisma EmailAccount model.
  const emailAccountForAgent = emailAccount as unknown as PrismaEmailAccount;

  // Get conversation for context
  const conversation = await ConversationService.getPrimaryWebConversation(
    emailAccount.userId,
  );

  // Extract the last user message content
  const lastUserMessage = messages[messages.length - 1].content;

  // Run the full agent with all tools (create/calendar, scheduling, etc.)
  const result = await runOneShotAgent({
    user: user as import("@/generated/prisma/client").User,
    emailAccount: emailAccountForAgent as import("@/generated/prisma/client").EmailAccount,
    message: lastUserMessage,
    context: {
      conversationId: conversation.id,
      channelId: "email",
      provider: "email",
      userId: emailAccount.userId,
      messageId: message.id,
      threadId: message.threadId,
    },
  });

  // Send the AI response back in the email thread
  if (result.text) {
    await provider.replyToEmail(message, result.text);
  }
}

function verifyUserSentEmail({
  message,
  userEmail,
}: {
  message: ParsedMessage;
  userEmail: string;
}) {
  return (
    extractEmailAddress(message.headers.from).toLowerCase() ===
    userEmail.toLowerCase()
  );
}

// Label the message with processing and assistant labels, and remove the processing label when done
async function withProcessingLabels<T>(
  messageId: string,
  provider: EmailProvider,
  emailAccountId: string,
  fn: () => Promise<T>,
  logger: Logger,
): Promise<T> {
  // Get labels first so we can reuse them
  const results = await Promise.allSettled([
    provider.getOrCreateAmodelLabel("processing"),
    provider.getOrCreateAmodelLabel("assistant"),
  ]);

  const [processingLabelResult, assistantLabelResult] = results;

  if (processingLabelResult.status === "rejected") {
    logger.error("Error getting processing label", {
      error: processingLabelResult.reason,
    });
  }

  if (assistantLabelResult.status === "rejected") {
    logger.error("Error getting assistant label", {
      error: assistantLabelResult.reason,
    });
  }

  const labels = results
    .map((result) => (result.status === "fulfilled" ? result.value : undefined))
    .filter(isDefined);

  if (labels.length) {
    // Fire and forget the initial labeling
    labelMessageAndSync({
      provider,
      messageId,
      labelId: labels[0].id,
      labelName: labels[0].name,
      emailAccountId,
      logger,
    }).catch((error) => {
      logger.error("Error labeling message", { error });
    });
  }

  try {
    return await fn();
  } finally {
    const processingLabel = results[0];
    const processingLabelId =
      processingLabel.status === "fulfilled"
        ? processingLabel.value?.id
        : undefined;
    if (processingLabelId) {
      await provider
        .removeThreadLabel(messageId, processingLabelId)
        .catch((error) => {
          logger.error("Error removing processing label", { error });
        });
    }
  }
}
