import { env } from "@/env";
import type { Logger } from "@/server/lib/logger";

import type { ParsedMessage } from "@/server/lib/types";
import type { EmailForAction } from "@/features/ai/types";

export async function enqueueDigestItem({
  email: _email,
  emailAccountId,
  actionId: _actionId,
  coldEmailId: _coldEmailId,
  logger,
}: {
  email: ParsedMessage | EmailForAction;
  emailAccountId: string;
  actionId?: string;
  coldEmailId?: string;
  logger: Logger;
}) {
  if (!env.NEXT_PUBLIC_DIGEST_ENABLED) {
    logger.info("Skipping digest enqueue: digest feature disabled", {
      emailAccountId,
    });
    return;
  }

  // Legacy digest summarization endpoint was removed with quarantine cleanup.
  // Keep this as an explicit no-op until the digest processor is rebuilt.
  logger.warn("Skipping digest enqueue: digest processor endpoint not available", {
    emailAccountId,
  });
}
