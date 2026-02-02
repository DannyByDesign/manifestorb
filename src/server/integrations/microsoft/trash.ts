import type { OutlookClient } from "@/server/integrations/microsoft/client";
import type { Logger } from "@/server/lib/logger";
import { withOutlookRetry } from "@/server/integrations/microsoft/retry";

export async function trashThread(options: {
  client: OutlookClient;
  threadId: string;
  ownerEmail: string;
  actionSource: "ai" | "user" | "cold-email";
  logger: Logger;
}) {
  const { client, threadId, ownerEmail, logger } = options;

  try {
    // In Outlook, trashing is moving to the Deleted Items folder
    // We need to move each message in the thread individually
    // Escape single quotes in threadId for the filter
    const escapedThreadId = threadId.replace(/'/g, "''");
    const messages = await client
      .getClient()
      .api("/me/messages")
      .filter(`conversationId eq '${escapedThreadId}'`)
      .get();

    await Promise.all(
      messages.value.map(async (message: { id: string }) => {
        try {
          return await withOutlookRetry(
            () =>
              client.getClient().api(`/me/messages/${message.id}/move`).post({
                destinationId: "deleteditems",
              }),
            logger,
          );
        } catch (error) {
          // Log the error but don't fail the entire operation
          logger.warn("Failed to move message to trash", {
            messageId: message.id,
            threadId,
            error,
          });
          return null;
        }
      }),
    );

    return { status: 200 };
  } catch (error: any) {
    // If the filter fails, try a different approach
    logger.warn("Filter failed, trying alternative approach", {
      threadId,
      error,
    });

    try {
      // Try to get messages by conversationId using a different endpoint
      const messages = await client
        .getClient()
        .api("/me/messages")
        .select("id")
        .get();

      // Filter messages by conversationId manually
      const threadMessages = messages.value.filter(
        (message: { conversationId: string }) =>
          message.conversationId === threadId,
      );

      if (threadMessages.length > 0) {
        // Move each message in the thread to the deleted items folder
        const movePromises = threadMessages.map(
          async (message: { id: string }) => {
            try {
              return await withOutlookRetry(
                () =>
                  client
                    .getClient()
                    .api(`/me/messages/${message.id}/move`)
                    .post({
                      destinationId: "deleteditems",
                    }),
                logger,
              );
            } catch (moveError) {
              // Log the error but don't fail the entire operation
              logger.warn("Failed to move message to trash", {
                messageId: message.id,
                threadId,
                error:
                  moveError instanceof Error ? moveError.message : moveError,
              });
              return null;
            }
          },
        );

        await Promise.allSettled(movePromises);
      } else {
        // If no messages found, try treating threadId as a messageId
        await withOutlookRetry(
          () =>
            client.getClient().api(`/me/messages/${threadId}/move`).post({
              destinationId: "deleteditems",
            }),
          logger,
        );
      }

      return { status: 200 };
    } catch (directError) {
      logger.error("Failed to trash thread", {
        threadId,
        ownerEmail,
        error: directError,
      });
      throw directError;
    }
  }
}
