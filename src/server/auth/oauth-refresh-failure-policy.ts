import { redis } from "@/server/lib/redis";
import type { Logger } from "@/server/lib/logger";

type InvalidGrantFailureState = {
  count: number;
  firstFailureAtMs: number;
  lastFailureAtMs: number;
};

const INVALID_GRANT_FAILURE_WINDOW_SECONDS = 60 * 30; // 30 minutes
const INVALID_GRANT_DISCONNECT_THRESHOLD = 3;

function getInvalidGrantFailureKey({
  provider,
  accountId,
}: {
  provider: string;
  accountId: string;
}) {
  return `oauth:invalid-grant:${provider}:${accountId}`;
}

export type InvalidGrantFailureDecision = {
  shouldDisconnect: boolean;
  attempts: number;
  threshold: number;
};

export async function recordInvalidGrantFailure({
  provider,
  accountId,
  logger,
}: {
  provider: string;
  accountId: string;
  logger: Logger;
}): Promise<InvalidGrantFailureDecision> {
  const key = getInvalidGrantFailureKey({ provider, accountId });
  const nowMs = Date.now();

  try {
    const existing = await redis.get<InvalidGrantFailureState>(key);
    const windowStartMs = nowMs - INVALID_GRANT_FAILURE_WINDOW_SECONDS * 1000;

    const next: InvalidGrantFailureState =
      existing &&
      typeof existing.count === "number" &&
      typeof existing.firstFailureAtMs === "number" &&
      existing.firstFailureAtMs >= windowStartMs
        ? {
            count: existing.count + 1,
            firstFailureAtMs: existing.firstFailureAtMs,
            lastFailureAtMs: nowMs,
          }
        : {
            count: 1,
            firstFailureAtMs: nowMs,
            lastFailureAtMs: nowMs,
          };

    await redis.set(key, next, { ex: INVALID_GRANT_FAILURE_WINDOW_SECONDS });

    const shouldDisconnect = next.count >= INVALID_GRANT_DISCONNECT_THRESHOLD;
    if (shouldDisconnect) {
      // Consume the counter on hard disconnect to avoid stale carryover.
      await redis.del(key);
    }

    return {
      shouldDisconnect,
      attempts: next.count,
      threshold: INVALID_GRANT_DISCONNECT_THRESHOLD,
    };
  } catch (error) {
    logger.warn(
      "Unable to record invalid_grant failure in Redis; skipping automatic disconnect",
      {
        provider,
        accountId,
        error,
      },
    );

    return {
      shouldDisconnect: false,
      attempts: 1,
      threshold: INVALID_GRANT_DISCONNECT_THRESHOLD,
    };
  }
}

export async function clearInvalidGrantFailures({
  provider,
  accountId,
  logger,
}: {
  provider: string;
  accountId: string;
  logger: Logger;
}) {
  const key = getInvalidGrantFailureKey({ provider, accountId });
  try {
    await redis.del(key);
  } catch (error) {
    logger.warn("Unable to clear invalid_grant failure state", {
      provider,
      accountId,
      error,
    });
  }
}
