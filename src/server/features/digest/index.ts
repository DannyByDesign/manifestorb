import { publishToQstashQueue } from "@/server/integrations/qstash";
import type { Logger } from "@/server/lib/logger";
import { emailToContent } from "@/server/lib/mail";
import { getInternalApiUrl } from "@/server/lib/internal-api";

import type { ParsedMessage } from "@/server/lib/types";
import type { EmailForAction } from "@/features/ai/types";

type DigestBody = any;

export async function enqueueDigestItem({
  email,
  emailAccountId,
  actionId,
  coldEmailId,
  logger,
}: {
  email: ParsedMessage | EmailForAction;
  emailAccountId: string;
  actionId?: string;
  coldEmailId?: string;
  logger: Logger;
}) {
  const url = `${getInternalApiUrl()}/api/ai/digest`;
  try {
    await publishToQstashQueue<DigestBody>({
      queueName: "digest-item-summarize",
      parallelism: 3, // Allow up to 3 concurrent jobs from this queue
      url,
      body: {
        emailAccountId,
        actionId,
        coldEmailId,
        message: {
          id: email.id,
          threadId: email.threadId,
          from: email.headers.from,
          to: email.headers.to || "",
          subject: email.headers.subject,
          content: emailToContent(email),
        },
      },
    });
  } catch (error) {
    logger.error("Failed to publish to Qstash", { error });
  }
}
