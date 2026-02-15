import { describe, expect, it, vi } from "vitest";
import { emitRuntimeTelemetry } from "@/server/features/ai/runtime/telemetry/schema";

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  } as never;
}

describe("runtime telemetry schema", () => {
  it("accepts valid fast-path telemetry payloads", () => {
    const logger = createLogger();

    emitRuntimeTelemetry(logger, "openworld.runtime.fast_path", {
      userId: "user-1",
      provider: "slack",
      mode: "strict",
      reason: "first_inbox_email",
      toolName: "email.searchInbox",
      decision: "executed",
      outcome: "success",
      latencyMs: 124,
      semanticConfidence: 0.88,
      semanticMargin: 0.16,
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("rejects invalid fast-path telemetry payloads", () => {
    const logger = createLogger();

    emitRuntimeTelemetry(logger, "openworld.runtime.fast_path", {
      userId: "user-1",
      provider: "slack",
      mode: "strict",
      reason: "",
      decision: "executed",
      outcome: "success",
    } as never);

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
