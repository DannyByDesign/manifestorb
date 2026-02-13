import type { ToolResult } from "@/server/features/ai/tools/types";

export interface RepairPolicy {
  maxAttempts: number;
  baseDelayMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(result: ToolResult): boolean {
  const error = String(result.error ?? "").toLowerCase();
  return (
    error.includes("transient") ||
    error.includes("rate_limit") ||
    error.includes("timeout") ||
    error.includes("etimedout") ||
    error.includes("temporar")
  );
}

export async function executeWithRepair(
  execute: () => Promise<ToolResult>,
  policy: RepairPolicy = { maxAttempts: 3, baseDelayMs: 300 },
): Promise<{ result: ToolResult; attempts: number }> {
  let attempt = 0;
  let lastResult: ToolResult | null = null;

  while (attempt < policy.maxAttempts) {
    attempt += 1;
    const result = await execute();
    if (result.success) {
      return { result, attempts: attempt };
    }

    lastResult = result;
    if (!isRetryable(result) || attempt >= policy.maxAttempts) {
      break;
    }

    const jitter = Math.floor(Math.random() * 120);
    await sleep(policy.baseDelayMs * attempt + jitter);
  }

  return {
    result:
      lastResult ??
      ({
        success: false,
        error: "unknown_repair_failure",
        message: "Execution failed with unknown error.",
      } satisfies ToolResult),
    attempts: attempt,
  };
}
