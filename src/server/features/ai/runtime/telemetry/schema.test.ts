import { describe, expect, it, vi } from "vitest";
import { emitRuntimeTelemetry } from "@/server/features/ai/runtime/telemetry/schema";

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  } as never;
}

describe("runtime telemetry schema", () => {
  it("accepts valid route-selected telemetry payloads", () => {
    const logger = createLogger();

    emitRuntimeTelemetry(logger, "openworld.runtime.route_selected", {
      userId: "user-1",
      provider: "slack",
      lane: "planner",
      profile: "fast",
      reason: "session_turn_contract",
      nativeMaxSteps: 1,
      nativeTurnTimeoutMs: 18_000,
      maxAttempts: 1,
      decisionTimeoutMs: 0,
      toolCatalogLimit: 0,
      includeSkillGuidance: false,
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("rejects invalid route-selected telemetry payloads", () => {
    const logger = createLogger();

    emitRuntimeTelemetry(logger, "openworld.runtime.route_selected", {
      userId: "user-1",
      provider: "slack",
      lane: "planner",
      profile: "fast",
      reason: "",
      nativeMaxSteps: 0,
      nativeTurnTimeoutMs: 0,
      maxAttempts: 1,
      decisionTimeoutMs: 0,
      toolCatalogLimit: 0,
      includeSkillGuidance: false,
    } as never);

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
