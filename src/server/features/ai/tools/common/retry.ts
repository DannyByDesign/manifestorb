import { sleep } from "@/server/lib/sleep";
import { computeExponentialBackoffDelay } from "@/server/features/ai/tools/common/backoff";

export function isProviderRateLimitError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("too many concurrent requests") ||
    normalized.includes("ratelimit") ||
    normalized.includes("rate limit") ||
    normalized.includes("429") ||
    normalized.includes("throttl")
  );
}

export async function withRetries<T>(
  operation: () => Promise<T>,
  options?: {
    attempts?: number;
    baseDelayMs?: number;
    jitterMaxMs?: number;
    isRetryable?: (error: unknown) => boolean;
    onRetry?: (params: {
      attempt: number;
      attempts: number;
      delayMs: number;
      error: unknown;
    }) => void;
    onExhausted?: (params: { attempts: number; error: unknown }) => void;
  },
): Promise<T> {
  const attempts = Math.max(1, options?.attempts ?? 3);
  const baseDelayMs = Math.max(50, options?.baseDelayMs ?? 700);
  const jitterMaxMs = Math.max(0, options?.jitterMaxMs ?? 300);
  const isRetryable = options?.isRetryable ?? isProviderRateLimitError;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt >= attempts) {
        if (isRetryable(error) && attempt >= attempts) {
          options?.onExhausted?.({
            attempts,
            error,
          });
        }
        throw error;
      }
      const delayMs = computeExponentialBackoffDelay({
        attempt,
        baseDelayMs,
        jitterMaxMs,
      });
      options?.onRetry?.({
        attempt,
        attempts,
        delayMs,
        error,
      });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
