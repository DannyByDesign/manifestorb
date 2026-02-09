import { describe, expect, it } from "vitest";
import { runOrchestrationPreflight } from "@/features/ai/orchestration/preflight";

describe("runOrchestrationPreflight", () => {
  const baseParams = {
    provider: "slack",
    userId: "user_123",
    emailAccount: {
      id: "acct_123",
      email: "user@example.com",
      userId: "user_123",
    },
  };

  it("returns zero-cost chat mode for short social turns", async () => {
    const result = await runOrchestrationPreflight({
      ...baseParams,
      message: "hello",
      hasPendingApproval: false,
      hasPendingScheduleProposal: false,
    });

    expect(result.mode).toBe("chat");
    expect(result.needsTools).toBe(false);
    expect(result.needsInternalData).toBe(false);
    expect(result.contextTier).toBe(0);
    expect(result.allowProactiveNudges).toBe(false);
  });

  it("keeps approval replies in action mode with tools enabled", async () => {
    const result = await runOrchestrationPreflight({
      ...baseParams,
      message: "approve",
      hasPendingApproval: true,
      hasPendingScheduleProposal: false,
    });

    expect(result.mode).toBe("action");
    expect(result.needsTools).toBe(true);
    expect(result.needsInternalData).toBe(true);
    expect(result.contextTier).toBe(1);
  });

  it("routes explicit lookup requests to lookup/action fast path", async () => {
    const result = await runOrchestrationPreflight({
      ...baseParams,
      message: "find emails from John this week",
      hasPendingApproval: false,
      hasPendingScheduleProposal: false,
    });

    expect(result.needsTools).toBe(true);
    expect(result.needsInternalData).toBe(true);
    expect(result.contextTier).toBe(2);
    expect(["lookup", "action"]).toContain(result.mode);
    expect(result.resourceHints).toContain("email");
  });

  it("routes natural language calendar lookup phrasing to tools", async () => {
    const result = await runOrchestrationPreflight({
      ...baseParams,
      message: "whats on my calendar today",
      hasPendingApproval: true,
      hasPendingScheduleProposal: false,
    });

    expect(result.mode).toBe("lookup");
    expect(result.needsTools).toBe(true);
    expect(result.needsInternalData).toBe(true);
    expect(result.contextTier).toBe(2);
    expect(result.resourceHints).toContain("calendar");
  });
});
