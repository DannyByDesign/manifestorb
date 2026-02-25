import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma, { resetPrismaMock } from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");

import {
  canRunProactiveAttention,
  canRunRuntimeTurn,
  recordRuntimeUsage,
} from "@/server/features/billing/usage";

describe("billing usage service", () => {
  beforeEach(() => {
    resetPrismaMock();
  });

  it("blocks runtime turns when hard cost cap is exceeded", async () => {
    prisma.userLimit.upsert.mockResolvedValue({
      monthlyCostSoftUsd: 2.8,
      monthlyCostHardUsd: 3.25,
      monthlyRuntimeTurnLimit: 3000,
      monthlyTotalTokenLimit: null,
    } as never);
    prisma.userMonthlyUsage.findUnique.mockResolvedValue({
      estimatedCostUsd: 3.5,
      runtimeTurns: 42,
      totalTokens: 12000,
    } as never);

    const decision = await canRunRuntimeTurn("user-1");

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("cost_hard_cap");
    expect(decision.currentCostUsd).toBe(3.5);
  });

  it("blocks proactive runs when proactive cap is exceeded", async () => {
    prisma.userLimit.upsert.mockResolvedValue({
      monthlyCostSoftUsd: 2.8,
      monthlyCostHardUsd: 3.25,
      monthlyProactiveRunLimit: 10,
    } as never);
    prisma.userMonthlyUsage.findUnique.mockResolvedValue({
      estimatedCostUsd: 1.2,
      proactiveRuns: 10,
    } as never);

    const decision = await canRunProactiveAttention("user-1");

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("proactive_run_cap");
    expect(decision.monthlyProactiveRuns).toBe(10);
  });

  it("records runtime usage into ledger and monthly rollup", async () => {
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));

    await recordRuntimeUsage({
      userId: "user-1",
      conversationId: "conv-1",
      provider: "web",
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      estimatedCostUsd: 0.0042,
      direction: "runtime_turn",
      metadata: { test: true },
    });

    expect(prisma.usageLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          conversationId: "conv-1",
          provider: "web",
          inputTokens: 120,
          outputTokens: 80,
          totalTokens: 200,
          direction: "runtime_turn",
        }),
      }),
    );

    expect(prisma.userMonthlyUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          runtimeTurns: { increment: 1 },
          proactiveRuns: { increment: 0 },
        }),
      }),
    );
  });
});
