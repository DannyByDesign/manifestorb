import { createEmailProvider } from "@/features/email/provider";
import { ActionType } from "@/generated/prisma/enums";
import { executeCanonicalEmailAutomations } from "@/server/features/policy-plane/automation-executor";
import type { Logger } from "@/server/lib/logger";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { ParsedMessage } from "@/server/types";

export async function bulkProcessInboxEmails({
  emailAccount,
  provider,
  maxEmails,
  skipArchive,
  logger: log,
}: {
  emailAccount: EmailAccountWithAI;
  provider: string;
  maxEmails: number;
  skipArchive: boolean;
  logger: Logger;
}) {
  const logger = log.with({ module: "bulk-process-emails" });

  logger.info("Starting bulk inbox email processing");

  try {
    const emailProvider = await createEmailProvider({
      emailAccountId: emailAccount.id,
      provider,
      logger,
    });

    const messages = await emailProvider.getInboxMessages(maxEmails);

    if (messages.length === 0) {
      logger.info("No inbox emails to process");
      return;
    }

    const uniqueMessages = getLatestMessagePerThread(messages);

    logger.info("Processing emails with canonical rule plane automations", {
      emailCount: uniqueMessages.length,
      totalFetched: messages.length,
      skipArchive,
    });

    let processedCount = 0;
    let errorCount = 0;

    for (const message of uniqueMessages) {
      try {
        await executeCanonicalEmailAutomations({
          provider: emailProvider,
          message,
          emailAccount,
          logger,
          ...(skipArchive ? { skipActionTypes: [ActionType.ARCHIVE] } : {}),
        });
        processedCount++;
      } catch (error) {
        errorCount++;
        logger.error("Error processing email", {
          messageId: message.id,
          error,
        });
        // Continue processing other emails even if one fails
      }
    }

    logger.info("Completed bulk email processing", {
      processedCount,
      errorCount,
      totalEmails: uniqueMessages.length,
    });
  } catch (error) {
    logger.error("Failed to process emails", { error });
  }
}

function getLatestMessagePerThread(messages: ParsedMessage[]): ParsedMessage[] {
  const latestByThread = new Map<string, ParsedMessage>();

  for (const message of messages) {
    const existing = latestByThread.get(message.threadId);
    if (
      !existing ||
      new Date(message.date || 0) > new Date(existing.date || 0)
    ) {
      latestByThread.set(message.threadId, message);
    }
  }

  return Array.from(latestByThread.values());
}
