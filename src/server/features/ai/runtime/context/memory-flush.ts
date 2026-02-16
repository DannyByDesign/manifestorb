import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import { MemoryRecordingService } from "@/features/memory/service";

const flushTracker = new Set<string>();
const MAX_TRACKED_KEYS = 10_000;

export function resolveMemoryFlushThresholdRatio(): number {
  const raw = process.env.RUNTIME_MEMORY_FLUSH_THRESHOLD_RATIO;
  if (typeof raw !== "string" || raw.trim().length === 0) return 0.9;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return 0.9;
  return Math.min(Math.max(parsed, 0.5), 0.99);
}

function flushKey(session: RuntimeSession): string {
  const conversationId = session.input.conversationId ?? "none";
  const messageId = session.input.messageId ?? session.input.threadId ?? session.input.message.slice(0, 24);
  return `${session.input.userId}:${conversationId}:${messageId}`;
}

function markFlush(key: string) {
  if (flushTracker.size > MAX_TRACKED_KEYS) {
    flushTracker.clear();
  }
  flushTracker.add(key);
}

export async function maybeRunPreCompactionMemoryFlush(params: {
  session: RuntimeSession;
  reason: "threshold" | "overflow";
}): Promise<boolean> {
  const key = flushKey(params.session);
  if (flushTracker.has(key)) return false;

  markFlush(key);

  try {
    const shouldRecord = await MemoryRecordingService.shouldRecord(params.session.input.userId);
    if (!shouldRecord) {
      return false;
    }

    await MemoryRecordingService.enqueueMemoryRecording(
      params.session.input.userId,
      params.session.input.email,
    );

    params.session.input.logger.info("Pre-compaction memory flush queued", {
      userId: params.session.input.userId,
      reason: params.reason,
    });
    return true;
  } catch (error) {
    params.session.input.logger.warn("Pre-compaction memory flush failed", {
      error,
      reason: params.reason,
    });
    return false;
  }
}
