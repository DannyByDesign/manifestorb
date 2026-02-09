import { describe, expect, it } from "vitest";
import {
  classifyStepBudgetProfile,
  computeAdaptiveMaxSteps,
} from "./step-budget";

describe("step budget classifier", () => {
  it("classifies simple lookup requests", () => {
    const profile = classifyStepBudgetProfile({
      message: "show emails from Yingying Sun from the last 7 days",
      provider: "slack",
      configuredMaxSteps: 20,
      hasPendingApproval: false,
      hasPendingScheduleProposal: false,
    });
    expect(profile).toBe("simple_lookup");
  });

  it("classifies pending approval replies as approval decisions", () => {
    const profile = classifyStepBudgetProfile({
      message: "approve",
      provider: "slack",
      configuredMaxSteps: 20,
      hasPendingApproval: true,
      hasPendingScheduleProposal: false,
    });
    expect(profile).toBe("approval_decision");
  });

  it("classifies cross-resource conditional requests as multi-step", () => {
    const profile = classifyStepBudgetProfile({
      message:
        "if I'm free Friday afternoon, schedule a meeting and then email me a summary",
      provider: "slack",
      configuredMaxSteps: 20,
      hasPendingApproval: false,
      hasPendingScheduleProposal: false,
    });
    expect(profile).toBe("multi_step");
  });
});

describe("adaptive step budget", () => {
  it("allocates low budget for simple lookups", () => {
    const result = computeAdaptiveMaxSteps({
      message: "find emails from mom this week",
      provider: "slack",
      configuredMaxSteps: 20,
      hasPendingApproval: false,
      hasPendingScheduleProposal: false,
    });

    expect(result.profile).toBe("simple_lookup");
    expect(result.maxSteps).toBe(4);
  });

  it("never exceeds configured max steps", () => {
    const result = computeAdaptiveMaxSteps({
      message: "schedule a call and then send a follow-up email",
      provider: "slack",
      configuredMaxSteps: 6,
      hasPendingApproval: false,
      hasPendingScheduleProposal: false,
    });

    expect(result.maxSteps).toBeLessThanOrEqual(6);
  });
});

