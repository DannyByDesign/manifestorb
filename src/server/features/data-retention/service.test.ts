import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma, { resetPrismaMock } from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");

import { applyOperationalRetentionPolicies } from "@/server/features/data-retention/service";

describe("operational data retention", () => {
  beforeEach(() => {
    resetPrismaMock();
  });

  it("applies retention operations and returns delete counts", async () => {
    prisma.dataRetentionPolicy.findMany.mockResolvedValue([] as never);
    prisma.$executeRaw
      .mockResolvedValueOnce(11 as never)
      .mockResolvedValueOnce(4 as never)
      .mockResolvedValueOnce(2 as never);
    prisma.policyExecutionLog.deleteMany.mockResolvedValue({ count: 9 } as never);
    prisma.policyDecisionLog.deleteMany.mockResolvedValue({ count: 7 } as never);
    prisma.pendingAgentTurnState.deleteMany.mockResolvedValue({ count: 5 } as never);

    const result = await applyOperationalRetentionPolicies();

    expect(result.deletedConversationMessages).toBe(11);
    expect(result.deletedApprovalDecisions).toBe(4);
    expect(result.deletedApprovalRequests).toBe(2);
    expect(result.deletedPolicyExecutionLogs).toBe(9);
    expect(result.deletedPolicyDecisionLogs).toBe(7);
    expect(result.deletedPendingTurnStates).toBe(5);
    expect(result.effectivePolicies.conversation_message_operational.retentionDays).toBe(90);
  });

  it("falls back to defaults when retention table is unavailable", async () => {
    prisma.dataRetentionPolicy.findMany.mockRejectedValue({ code: "P2021" } as never);
    prisma.$executeRaw
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never);
    prisma.policyExecutionLog.deleteMany.mockResolvedValue({ count: 0 } as never);
    prisma.policyDecisionLog.deleteMany.mockResolvedValue({ count: 0 } as never);
    prisma.pendingAgentTurnState.deleteMany.mockResolvedValue({ count: 0 } as never);

    const result = await applyOperationalRetentionPolicies();

    expect(result.effectivePolicies.approval_operational.retentionDays).toBe(90);
  });
});
