import { createScopedLogger } from "@/server/lib/logger";
import prisma from "@/server/db/client";

const logger = createScopedLogger("bulk-action-tracking");

export async function updateEmailMessagesForSender(options: {
  sender: string;
  messageIds: string[];
  emailAccountId: string;
  action: "archive" | "trash";
}): Promise<void> {
  const { sender, messageIds, emailAccountId, action } = options;

  try {
    if (action === "trash") {
      const result = await prisma.emailMessage.deleteMany({
        where: {
          emailAccountId,
          from: sender,
          messageId: { in: messageIds },
        },
      });

      logger.info("Deleted EmailMessage records", {
        sender,
        emailAccountId,
        action,
        deletedCount: result.count,
        messageIdsCount: messageIds.length,
      });
    } else {
      const result = await prisma.emailMessage.updateMany({
        where: {
          emailAccountId,
          from: sender,
          messageId: { in: messageIds },
        },
        data: {
          inbox: false,
        },
      });

      logger.info("Updated EmailMessage records", {
        sender,
        emailAccountId,
        action,
        updatedCount: result.count,
        messageIdsCount: messageIds.length,
      });
    }
  } catch (error) {
    logger.error("Failed to update/delete EmailMessage records", {
      sender,
      emailAccountId,
      action,
      error,
    });
    // Don't throw - this is analytics, shouldn't break the main flow
  }
}
