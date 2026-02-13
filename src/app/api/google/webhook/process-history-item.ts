import type { gmail_v1 } from "@googleapis/gmail";
import type { ProcessHistoryOptions } from "@/app/api/google/webhook/types";
import { HistoryEventType } from "@/app/api/google/webhook/types";
import { createEmailProvider } from "@/features/email/provider";
import { handleLabelRemovedEvent } from "@/app/api/google/webhook/process-label-removed-event";
import { processHistoryItem as processHistoryItemShared } from "@/features/webhooks/process-history-item";
import { markMessageAsProcessing } from "@/server/lib/redis/message-processing";
import type { Logger } from "@/server/lib/logger";

export async function processHistoryItem(
  historyItem: {
    type: HistoryEventType;
    item:
      | gmail_v1.Schema$HistoryMessageAdded
      | gmail_v1.Schema$HistoryLabelAdded
      | gmail_v1.Schema$HistoryLabelRemoved;
  },
  options: ProcessHistoryOptions,
  logger: Logger,
) {
  const { emailAccount, hasAutomationRules, hasAiAccess } = options;
  const { type, item } = historyItem;
  const messageId = item.message?.id;
  const threadId = item.message?.threadId;
  const emailAccountId = emailAccount.id;

  if (!messageId || !threadId) return;

  logger.info("Gmail history item received", {
    eventType: type,
    labelIds: item.message?.labelIds,
  });

  const provider = await createEmailProvider({
    emailAccountId,
    provider: "google",
    logger,
  });

  // Handle Google-specific label events
  if (type === HistoryEventType.LABEL_REMOVED) {
    logger.info("Processing label removed event for learning");
    return handleLabelRemovedEvent(
      item,
      {
        emailAccount,
        provider,
      },
      logger,
    );
  } else if (type === HistoryEventType.LABEL_ADDED) {
    logger.info("Processing label added event for learning");
    return;
  }

  // Lock before fetching to avoid extra API calls for duplicate webhooks
  const isFree = await markMessageAsProcessing({
    userEmail: emailAccount.email,
    messageId,
  });
  if (!isFree) {
    logger.info("Skipping. Message already being processed.");
    return;
  }

  logger.info("Gmail lock acquired, calling shared processor");

  return processHistoryItemShared(
    { messageId, threadId },
    {
      provider,
      emailAccount,
      hasAutomationRules,
      hasAiAccess,
      logger,
    },
  );
}
