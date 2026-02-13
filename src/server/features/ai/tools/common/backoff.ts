export interface BackoffInput {
  attempt: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMaxMs?: number;
}

export function computeExponentialBackoffDelay(params: BackoffInput): number {
  const attempt = Math.max(1, params.attempt);
  const baseDelayMs = Math.max(50, params.baseDelayMs ?? 500);
  const maxDelayMs = Math.max(baseDelayMs, params.maxDelayMs ?? 15_000);
  const jitterMaxMs = Math.max(0, params.jitterMaxMs ?? 300);

  const exponent = Math.min(10, attempt - 1);
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
  const jitter = jitterMaxMs > 0 ? Math.floor(Math.random() * jitterMaxMs) : 0;
  return Math.min(maxDelayMs, exponential + jitter);
}
