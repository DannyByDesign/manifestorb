import { after } from "next/server";
import prisma from "@/server/db/client";
import { runRules } from "@/server/integrations/ai/choose-rule/run-rules";
import { categorizeSender } from "@/utils/categorize/senders/categorize";
import { isAssistantEmail } from "@/utils/assistant/is-assistant-email";
import { processAssistantEmail } from "@/utils/assistant/process-assistant-email";
import { isFilebotEmail } from "@/utils/filebot/is-filebot-email";
import { processFilingReply } from "@/utils/drive/handle-filing-reply";
import {
  processAttachment,
  getExtractableAttachments,
} from "@/utils/drive/filing-engine";
import { handleOutboundMessage } from "@/utils/reply-tracker/handle-outbound";
import { clearFollowUpLabel } from "@/utils/follow-up/labels";
import { ActionType, NewsletterStatus } from "@/generated/prisma/enums";
import type { EmailAccount } from "@/generated/prisma/client";
import { extractEmailAddress, extractNameFromEmail } from "@/utils/email";
import { isIgnoredSender } from "@/utils/filter-ignored-senders";
import type { EmailProvider } from "@/server/services/email/types";
import type { ParsedMessage, RuleWithActions } from "@/utils/types";
import type { EmailAccountWithAI } from "@/utils/llms/types";
import type { Logger } from "@/utils/logger";
import { captureException } from "@/utils/error";

export type SharedProcessHistoryOptions = {
  provider: EmailProvider;
  rules: RuleWithActions[];
  hasAutomationRules: boolean;
  hasAiAccess: boolean;
  emailAccount: EmailAccountWithAI &
  Pick<
    EmailAccount,
    "autoCategorizeSenders" | "filingEnabled" | "filingPrompt" | "email"
  >;
  logger: Logger;
};

export async function processHistoryItem(
  {
    messageId,
    threadId,
    message,
  }: {
    messageId: string;
    threadId?: string;
    message?: ParsedMessage;
  },
  options: SharedProcessHistoryOptions,
) {
  const {
    provider,
    emailAccount,
    hasAutomationRules,
    hasAiAccess,
    rules,
    logger,
  } = options;

  const emailAccountId = emailAccount.id;
  const userEmail = emailAccount.email;

  try {
    logger.info("Shared processor started");

    // Use pre-fetched message if provided, otherwise fetch it
    const parsedMessage = message ?? (await provider.getMessage(messageId));

    if (isIgnoredSender(parsedMessage.headers.from)) {
      logger.info("Skipping. Ignored sender.");
      return;
    }

    // Get threadId from message if not provided
    const actualThreadId = threadId || parsedMessage.threadId;

    const hasExistingRule = actualThreadId
      ? await prisma.executedRule.findFirst({
        where: {
          emailAccountId,
          threadId: actualThreadId,
          messageId,
        },
        select: { id: true },
      })
      : null;

    if (hasExistingRule) {
      logger.info("Skipping. Rule already exists.");
      return;
    }

    const isForAssistant = isAssistantEmail({
      userEmail,
      emailToCheck: parsedMessage.headers.to,
    });

    if (isForAssistant) {
      logger.info("Passing through assistant email.");
      return processAssistantEmail({
        message: parsedMessage,
        emailAccountId,
        userEmail,
        provider,
        logger,
      });
    }

    const isFromAssistant = isAssistantEmail({
      userEmail,
      emailToCheck: parsedMessage.headers.from,
    });

    if (isFromAssistant) {
      logger.info("Skipping. Assistant email.");
      return;
    }

    const isForFilebot = isFilebotEmail({
      userEmail,
      emailToCheck: parsedMessage.headers.to,
    });

    if (isForFilebot) {
      logger.info("Processing filebot reply.");
      return processFilingReply({
        message: parsedMessage,
        emailAccountId,
        userEmail,
        emailProvider: provider,
        emailAccount,
        logger,
      });
    }

    const isOutbound = provider.isSentMessage(parsedMessage);

    logger.info("Message direction check", {
      isOutbound,
      labelIds: parsedMessage.labelIds,
    });
    logger.trace("Message direction details", {
      from: parsedMessage.headers.from,
      to: parsedMessage.headers.to,
    });

    if (isOutbound) {
      await handleOutboundMessage({
        emailAccount,
        message: parsedMessage,
        provider,
        logger,
      });
      return;
    }

    // check if unsubscribed
    const email = extractEmailAddress(parsedMessage.headers.from);
    const sender = await prisma.newsletter.findFirst({
      where: {
        emailAccountId,
        email,
        status: NewsletterStatus.UNSUBSCRIBED,
      },
    });

    if (sender) {
      await provider.blockUnsubscribedEmail(messageId);
      logger.info("Skipping. Blocked unsubscribed email.", { from: email });
      return;
    }

    if (!hasAiAccess) {
      logger.info("Skipping. No AI access.");
      return;
    }

    // categorize a sender if we haven't already
    // this is used for category filters in ai rules
    if (emailAccount.autoCategorizeSenders) {
      const sender = extractEmailAddress(parsedMessage.headers.from);
      const senderName = extractNameFromEmail(parsedMessage.headers.from);
      const existingSender = await prisma.newsletter.findUnique({
        where: {
          email_emailAccountId: { email: sender, emailAccountId },
        },
        select: { category: true },
      });
      if (!existingSender?.category) {
        await categorizeSender(
          sender,
          emailAccount,
          provider,
          undefined,
          senderName !== sender ? senderName : undefined,
        );
      }
    }

    logger.info("Pre-rules check", { hasAutomationRules, hasAiAccess });

    if (hasAutomationRules && hasAiAccess) {
      logger.info("Running rules...");

      const ruleResults = await runRules({
        provider: provider as any,
        emailAccount: emailAccount as any,
        message: parsedMessage,
        rules: rules as any,
        isTest: false,
        modelType: "chat",
        logger,
      });

      // Check if any rule archived or deleted the message
      const shouldSuppressNotification = ruleResults.some((result) => {
        const isSkipped = result.status === "SKIPPED";
        if (isSkipped) return false;

        return result.actionItems?.some(
          (action) =>
            action.type === ActionType.ARCHIVE ||
            action.type === ActionType.MARK_READ
        );
      });

      if (shouldSuppressNotification) {
        logger.info("Suppressing notification due to rule outcome (Archive/Delete/Read)");
        return;
      }
    }

    // Process attachments for document filing (runs in parallel with rules if both enabled)
    if (
      emailAccount.filingEnabled &&
      emailAccount.filingPrompt &&
      hasAiAccess
    ) {
      after(async () => {
        const extractableAttachments = getExtractableAttachments(parsedMessage);

        if (extractableAttachments.length > 0) {
          logger.info("Processing attachments for filing", {
            count: extractableAttachments.length,
          });

          // Process each attachment (don't await all - let them run in background)
          for (const attachment of extractableAttachments) {
            await processAttachment({
              emailAccount: {
                ...emailAccount,
                filingEnabled: emailAccount.filingEnabled,
                filingPrompt: emailAccount.filingPrompt,
                email: emailAccount.email,
              },
              message: parsedMessage,
              attachment,
              emailProvider: provider,
              logger,
            }).catch((error) => {
              logger.error("Failed to process attachment", {
                filename: attachment.filename,
                error,
              });
            });
          }
        }
      });
    }

    // Remove follow-up label if present (they replied, so follow-up no longer needed)
    // This handles the case where we were awaiting a reply from them
    try {
      await clearFollowUpLabel({
        emailAccountId,
        threadId: actualThreadId,
        provider,
        logger,
      });
    } catch (error) {
      logger.error("Error removing follow-up label on inbound", { error });
      captureException(error, { emailAccountId });
    }

    // 5. Smart Push Notification (Open Claw Logic)
    // Only push if it's an inbound message and we haven't filtered it out already
    // 5. Smart Push Notification (Open Claw Logic)
    // Only push if it's an inbound message and we haven't filtered it out already
    // Filtering Logic:
    // 1. Must be inbound (checked above)
    // 2. Must NOT be archived/deleted by rules (checked above)
    // 3. Must be IMPORTANT (Gmail Label) OR explicitly marked as Personal/Updates
    const isImportant = parsedMessage.labelIds?.includes("IMPORTANT");
    const isCategoryPersonal = parsedMessage.labelIds?.includes("CATEGORY_PERSONAL");

    // We allow CATEGORY_UPDATES too generally, but let's restrict to Important for now to match user request
    const shouldPush = !isOutbound && (isImportant || isCategoryPersonal);

    if (shouldPush) {
      try {
        const { ChannelRouter } = await import("@/server/channels/router");
        const { generateNotification } = await import(
          "@/server/services/notification/generator"
        );
        const router = new ChannelRouter();

        // Extract basic details
        const fromName = extractNameFromEmail(parsedMessage.headers.from) || parsedMessage.headers.from;
        const subject = parsedMessage.headers.subject || "(No Subject)";
        const snippet = parsedMessage.snippet || "";

        // Generate conversational content using LLM
        const text = await generateNotification(
          {
            type: "email",
            source: fromName,
            title: subject,
            detail: snippet,
            importance: "medium", // Default for now
          },
          { emailAccount }
        );

        // Fire and forget - don't block the webhook response
        void router.pushMessage(emailAccount.userId, text).catch(err => {
          logger.error("Failed to push notification", { error: err });
        });
      } catch (err) {
        logger.error("Error initiating push notification", { error: err });
      }
    }
  } catch (error: unknown) {
    // Handle provider-specific "not found" errors
    if (error instanceof Error) {
      const isGoogleNotFound =
        error.message === "Requested entity was not found.";

      // Outlook can return ErrorItemNotFound code or "not found in the store" message
      const err = error as { code?: string };
      const isOutlookNotFound =
        err?.code === "ErrorItemNotFound" ||
        err?.code === "itemNotFound" ||
        error.message.includes("ItemNotFound") ||
        error.message.includes("not found in the store") ||
        error.message.includes("ResourceNotFound");

      if (isGoogleNotFound || isOutlookNotFound) {
        logger.info("Message not found");
        return;
      }
    }

    logger.error("Error processing message", { error });
    throw error;
  }
}
