import type { gmail_v1 } from "@googleapis/gmail";
import { GmailLabel } from "@/server/integrations/google/label";
import { withGmailRetry } from "@/server/integrations/google/retry";

export async function markSpam(options: {
  gmail: gmail_v1.Gmail;
  threadId: string;
}) {
  const { gmail, threadId } = options;

  return withGmailRetry(() =>
    gmail.users.threads.modify({
      userId: "me",
      id: threadId,
      requestBody: {
        addLabelIds: [GmailLabel.SPAM],
      },
    }),
  );
}
