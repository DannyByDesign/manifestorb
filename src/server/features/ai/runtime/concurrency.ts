import { createHash } from "crypto";
import PQueue from "p-queue";

const USER_RUNTIME_CONCURRENCY = 1;
const RUNTIME_QUEUE_TTL_MS = 10 * 60 * 1000;

const runtimeQueues = new Map<string, { queue: PQueue; touchedAt: number }>();

function queueKeyForUser(userId: string): string {
  return createHash("sha1").update(userId).digest("hex").slice(0, 16);
}

function evictExpiredQueues(now: number): void {
  for (const [key, entry] of runtimeQueues.entries()) {
    if (now - entry.touchedAt > RUNTIME_QUEUE_TTL_MS) {
      runtimeQueues.delete(key);
    }
  }
}

function getOrCreateQueue(userId: string): PQueue {
  const now = Date.now();
  evictExpiredQueues(now);
  const key = queueKeyForUser(userId);
  const existing = runtimeQueues.get(key);
  if (existing) {
    existing.touchedAt = now;
    return existing.queue;
  }

  const queue = new PQueue({ concurrency: USER_RUNTIME_CONCURRENCY });
  runtimeQueues.set(key, { queue, touchedAt: now });
  return queue;
}

export async function withUserRuntimeConcurrencyLimit<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const queue = getOrCreateQueue(userId);
  return queue.add(fn);
}
