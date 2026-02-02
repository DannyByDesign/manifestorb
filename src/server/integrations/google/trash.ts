import type { gmail_v1 } from "@googleapis/gmail";
import { createScopedLogger } from "@/server/lib/logger";
import { withGmailRetry } from "@/server/integrations/google/retry";

const logger = createScopedLogger("gmail/trash");

// trash moves the thread/message to the trash folder
// delete immediately deletes the thread/message
// trash does not require delete access from Gmail API

export async function trashThread(options: {
  gmail: gmail_v1.Gmail;
  threadId: string;
  ownerEmail: string;
  actionSource: "ai" | "user" | "cold-email";
}) {
  const { gmail, threadId, ownerEmail } = options;

  try {
    return await withGmailRetry(() =>
      gmail.users.threads.trash({
        userId: "me",
        id: threadId,
      }),
    );
  } catch (error: any) {
    if (error.message === "Requested entity was not found.") {
      // thread doesn't exist, so it's already been deleted
      logger.warn("Failed to trash non-existant thread", {
        email: ownerEmail,
        threadId,
        error,
      });
      return { status: 200 };
    }
    logger.error("Failed to trash thread", {
      email: ownerEmail,
      threadId,
      error,
    });
    throw error;
  }
}

export async function trashMessage(options: {
  gmail: gmail_v1.Gmail;
  messageId: string;
}) {
  const { gmail, messageId } = options;

  return withGmailRetry(() =>
    gmail.users.messages.trash({
      userId: "me",
      id: messageId,
    }),
  );
}
