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

    expect(result.mode).toBe("action");
    expect(result.needsTools).toBe(true);
    expect(result.needsInternalData).toBe(true);
    expect(result.contextTier).toBe(2);
    expect(result.resourceHints).toContain("calendar");
  });

  it("routes draft creation follow-up phrasing to action mode", async () => {
    const result = await runOrchestrationPreflight({
      ...baseParams,
      message: "create the draft",
      hasPendingApproval: true,
      hasPendingScheduleProposal: false,
    });

    expect(result.mode).toBe("action");
    expect(result.needsTools).toBe(true);
    expect(result.contextTier).toBeGreaterThanOrEqual(1);
  });

  it("routes correction turns with pending approval to action mode", async () => {
    const result = await runOrchestrationPreflight({
      ...baseParams,
      message: "it should be email and calendar agent right now",
      hasPendingApproval: true,
      hasPendingScheduleProposal: false,
    });

    expect(result.mode).toBe("action");
    expect(result.needsTools).toBe(true);
    expect(result.needsInternalData).toBe(true);
    expect(result.contextTier).toBe(2);
    expect(result.resourceHints).toContain("email");
  });

  it("routes schedule-proposal corrections with pending proposal to action mode", async () => {
    const result = await runOrchestrationPreflight({
      ...baseParams,
      message: "actually make it 30 minutes instead",
      hasPendingApproval: false,
      hasPendingScheduleProposal: true,
    });

    expect(result.mode).toBe("action");
    expect(result.needsTools).toBe(true);
    expect(result.resourceHints).toContain("calendar");
  });

  it("routes direct email composition with email address to action mode", async () => {
    const result = await runOrchestrationPreflight({
      ...baseParams,
      message:
        "<mailto:iamsunyy@gmail.com|iamsunyy@gmail.com> just let her know I'm testing the AI agent",
      hasPendingApproval: false,
      hasPendingScheduleProposal: false,
    });

    expect(["lookup", "action"]).toContain(result.mode);
    expect(result.needsTools).toBe(true);
    expect(result.resourceHints).toContain("email");
  });
});
