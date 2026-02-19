import { AsyncLocalStorage } from "node:async_hooks";

interface RuntimeDeadlineContext {
  deadlineMs: number;
  startedAtMs: number;
}

const runtimeDeadlineStore = new AsyncLocalStorage<RuntimeDeadlineContext>();

export function runWithRuntimeDeadlineContext<T>(
  context: RuntimeDeadlineContext,
  run: () => T,
): T {
  return runtimeDeadlineStore.run(context, run);
}

export function getRuntimeDeadlineMs(): number | undefined {
  return runtimeDeadlineStore.getStore()?.deadlineMs;
}

export function getRuntimeRemainingMs(nowMs = Date.now()): number | undefined {
  const deadlineMs = getRuntimeDeadlineMs();
  if (typeof deadlineMs !== "number") return undefined;
  return deadlineMs - nowMs;
}

export function capTimeoutToRuntimeBudget(params: {
  requestedMs: number;
  minimumMs?: number;
  reserveMs?: number;
}): number {
  const requestedMs = Math.max(1, Math.trunc(params.requestedMs));
  const minimumMs = Math.max(1, Math.trunc(params.minimumMs ?? 250));
  const reserveMs = Math.max(0, Math.trunc(params.reserveMs ?? 250));
  const remainingMs = getRuntimeRemainingMs();
  if (typeof remainingMs !== "number") return requestedMs;
  if (remainingMs <= reserveMs) return minimumMs;
  return Math.max(minimumMs, Math.min(requestedMs, remainingMs - reserveMs));
}

export const __testing = {
  getContext: (): RuntimeDeadlineContext | undefined => runtimeDeadlineStore.getStore(),
};
