import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearInvalidGrantFailures,
  recordInvalidGrantFailure,
} from "@/server/auth/oauth-refresh-failure-policy";
import { redis } from "@/server/lib/redis";

vi.mock("@/server/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

const logger = {
  warn: vi.fn(),
} as any;

describe("oauth-refresh-failure-policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records first invalid_grant failure without disconnecting", async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    const decision = await recordInvalidGrantFailure({
      provider: "google",
      accountId: "acc_1",
      logger,
    });

    expect(decision.shouldDisconnect).toBe(false);
    expect(decision.attempts).toBe(1);
    expect(redis.set).toHaveBeenCalled();
  });

  it("disconnects once threshold is reached", async () => {
    vi.mocked(redis.get).mockResolvedValue({
      count: 2,
      firstFailureAtMs: Date.now(),
      lastFailureAtMs: Date.now(),
    });

    const decision = await recordInvalidGrantFailure({
      provider: "google",
      accountId: "acc_1",
      logger,
    });

    expect(decision.shouldDisconnect).toBe(true);
    expect(decision.attempts).toBe(3);
    expect(redis.del).toHaveBeenCalled();
  });

  it("fails open (no disconnect) when redis is unavailable", async () => {
    vi.mocked(redis.get).mockRejectedValue(new Error("redis down"));

    const decision = await recordInvalidGrantFailure({
      provider: "google",
      accountId: "acc_1",
      logger,
    });

    expect(decision.shouldDisconnect).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("clears cached failure state safely", async () => {
    await clearInvalidGrantFailures({
      provider: "google",
      accountId: "acc_1",
      logger,
    });

    expect(redis.del).toHaveBeenCalled();
  });
});
