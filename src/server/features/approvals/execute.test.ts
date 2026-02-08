import { describe, it, expect, beforeEach, vi } from "vitest";
import { executeApprovalRequest } from "@/features/approvals/execute";
import prisma from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");

const mockCreateAgentTools = vi.fn();
vi.mock("@/features/ai/tools", () => ({
  createAgentTools: (...args: unknown[]) => mockCreateAgentTools(...args),
}));

describe("executeApprovalRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes tool when approval is granted", async () => {
    prisma.$transaction.mockImplementation(
      async (callback: (tx: any) => unknown) => callback(prisma as any),
    );
    prisma.approvalRequest.findUnique
      .mockResolvedValueOnce({
      id: "req-1",
      userId: "user-1",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      } as any)
      .mockResolvedValueOnce({
        id: "req-1",
        userId: "user-1",
        requestPayload: { tool: "reply", args: { messageId: "msg-1" } },
        user: {
          emailAccounts: [{ id: "email-1", account: { provider: "google" } }],
        },
      } as any);
    prisma.approvalRequest.update.mockResolvedValue({} as any);
    prisma.approvalDecision.create.mockResolvedValue({
      decision: "APPROVE",
    } as any);
    prisma.approvalRequest.findUnique.mockResolvedValue({
      id: "req-1",
      userId: "user-1",
      requestPayload: { tool: "reply", args: { messageId: "msg-1" } },
      user: {
        emailAccounts: [{ id: "email-1", account: { provider: "google" } }],
      },
    } as any);

    const mockTool = { execute: vi.fn().mockResolvedValue({ ok: true }) };
    mockCreateAgentTools.mockResolvedValue({ reply: mockTool });

    const result = await executeApprovalRequest({
      approvalRequestId: "req-1",
      decidedByUserId: "user-1",
    });

    expect(mockCreateAgentTools).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
      }),
    );
    expect(mockTool.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "msg-1",
        preApproved: true,
        approvalId: "req-1",
      }),
    );
    expect(result.executionResult).toEqual({ ok: true });
  });

  it("throws when tool is not found", async () => {
    prisma.$transaction.mockImplementation(
      async (callback: (tx: any) => unknown) => callback(prisma as any),
    );
    prisma.approvalRequest.findUnique
      .mockResolvedValueOnce({
      id: "req-2",
      userId: "user-1",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      } as any)
      .mockResolvedValueOnce({
        id: "req-2",
        userId: "user-1",
        requestPayload: { tool: "missing", args: {} },
        user: {
          emailAccounts: [{ id: "email-1", account: { provider: "google" } }],
        },
      } as any);
    prisma.approvalRequest.update.mockResolvedValue({} as any);
    prisma.approvalDecision.create.mockResolvedValue({
      decision: "APPROVE",
    } as any);
    prisma.approvalRequest.findUnique.mockResolvedValue({
      id: "req-2",
      userId: "user-1",
      requestPayload: { tool: "missing", args: {} },
      user: {
        emailAccounts: [{ id: "email-1", account: { provider: "google" } }],
      },
    } as any);
    mockCreateAgentTools.mockResolvedValue({});

    await expect(
      executeApprovalRequest({
        approvalRequestId: "req-2",
        decidedByUserId: "user-1",
      }),
    ).rejects.toThrow("Tool missing not found in agent tools");
  });

  it("throws when request or user is missing", async () => {
    prisma.$transaction.mockImplementation(
      async (callback: (tx: any) => unknown) => callback(prisma as any),
    );
    prisma.approvalRequest.findUnique
      .mockResolvedValueOnce({
      id: "req-3",
      userId: "user-1",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      } as any)
      .mockResolvedValueOnce(null);
    prisma.approvalRequest.update.mockResolvedValue({} as any);
    prisma.approvalDecision.create.mockResolvedValue({
      decision: "APPROVE",
    } as any);
    prisma.approvalRequest.findUnique.mockResolvedValue(null);

    await expect(
      executeApprovalRequest({
        approvalRequestId: "req-3",
        decidedByUserId: "user-1",
      }),
    ).rejects.toThrow("Approval request or user not found");
  });
});
