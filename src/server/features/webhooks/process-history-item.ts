import prisma from "@/server/db/client";
import { ActionType, NewsletterStatus } from "@/generated/prisma/enums";
import type { EmailAccount } from "@/generated/prisma/client";
import { extractEmailAddress } from "@/server/lib/email";
import { isIgnoredSender } from "@/server/lib/filter-ignored-senders";
import type { EmailProvider } from "@/features/email/types";
import type { ParsedMessage } from "@/server/lib/types";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { Logger } from "@/server/lib/logger";
import { executeCanonicalEmailAutomations } from "@/server/features/policy-plane/automation-executor";

export type SharedProcessHistoryOptions = {
  provider: EmailProvider;
  hasAutomationRules: boolean;
  hasAiAccess: boolean;
  emailAccount: EmailAccountWithAI &
  Pick<
    EmailAccount,
    "autoCategorizeSenders" | "email"
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
    hasAiAccess,
    hasAutomationRules,
    logger,
  } = options;

  const emailAccountId = emailAccount.id;

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
      logger.info("Skipping outbound message in webhook processor");
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

    logger.info("Running canonical automation executor", { hasAiAccess });

    const canonicalAutomationResults = hasAutomationRules
      ? await executeCanonicalEmailAutomations({
          provider,
          message: parsedMessage,
          emailAccount,
          logger,
        })
      : [];

    const shouldSuppressNotificationFromCanonical = canonicalAutomationResults.some(
      (result) =>
        result.status === "applied" &&
        result.actionTypes.some(
          (type) => type === ActionType.ARCHIVE || type === ActionType.MARK_READ,
        ),
    );

    if (shouldSuppressNotificationFromCanonical) {
      logger.info("Suppressing notification due to rule outcome (Archive/Delete/Read)");
      return;
    }

    // Push notifications are handled by conversational responses and rule actions.
  } catch (error: unknown) {
    // Handle provider-specific "not found" errors
    if (error instanceof Error) {
      const isGoogleNotFound =
        error.message === "Requested entity was not found.";

      if (isGoogleNotFound) {
        logger.info("Message not found");
        return;
      }
    }

    logger.error("Error processing message", { error });
    throw error;
  }
}
