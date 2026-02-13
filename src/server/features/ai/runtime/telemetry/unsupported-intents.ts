import { createHash } from "crypto";
import type { Logger } from "@/server/lib/logger";

function normalizeIntentKey(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);
}

export function emitUnsupportedIntent(params: {
  logger: Logger;
  userId: string;
  provider: string;
  message: string;
  reason: string;
}): void {
  const normalized = normalizeIntentKey(params.message);
  const intentKey = createHash("sha1").update(normalized).digest("hex").slice(0, 16);

  params.logger.warn("openworld.unsupported_intent", {
    userId: params.userId,
    provider: params.provider,
    reason: params.reason,
    intentKey,
    normalized,
  });
}
