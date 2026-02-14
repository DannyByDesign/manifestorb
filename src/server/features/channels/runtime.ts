import PQueue from "p-queue";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("ChannelsRuntime");
const queues = new Map<string, PQueue>();
const TASK_TIMEOUT_MS = 210_000;

function getQueue(key: string): PQueue {
  const existing = queues.get(key);
  if (existing) return existing;
  const created = new PQueue({ concurrency: 1 });
  queues.set(key, created);
  return created;
}

function maybeCleanupQueue(key: string, queue: PQueue): void {
  if (queue.pending > 0 || queue.size > 0) return;
  queues.delete(key);
}

export async function runSerializedConversationTurn<T>(params: {
  queueKey: string;
  provider: string;
  channelId: string;
  threadId: string;
  execute: () => Promise<T>;
}): Promise<T> {
  const queue = getQueue(params.queueKey);
  const enqueuedAt = Date.now();

  try {
    const result = await queue.add(
      async () => {
        const waitMs = Date.now() - enqueuedAt;
        logger.trace("Processing queued conversation turn", {
          provider: params.provider,
          channelId: params.channelId,
          threadId: params.threadId,
          waitMs,
          queueSize: queue.size,
          queuePending: queue.pending,
        });
        return params.execute();
      },
      {
        timeout: TASK_TIMEOUT_MS,
      },
    );
    return result as T;
  } finally {
    maybeCleanupQueue(params.queueKey, queue);
  }
}
