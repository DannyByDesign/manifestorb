import { describe, it, expect, beforeEach, vi } from "vitest";
import { ApprovalService } from "@/features/approvals/service";
import type { PrismaClient } from "@/generated/prisma/client";
import { mockDeep, mockReset } from "vitest-mock-extended";

const prismaMock = mockDeep<PrismaClient>();

describe("ApprovalService", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns existing request for idempotency key", async () => {
    const existing = { id: "req-1" } as any;
    prismaMock.approvalRequest.findUnique.mockResolvedValue(existing);

    const service = new ApprovalService(prismaMock);
    const result = await service.createRequest({
      userId: "user-1",
      provider: "slack",
      externalContext: { channelId: "c-1" },
      requestPayload: { actionType: "tool", description: "desc", args: {} },
      idempotencyKey: "idem-1",
    });

    expect(result).toBe(existing);
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("creates a new approval request with expiry", async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(null);
    prismaMock.approvalRequest.create.mockResolvedValue({
      id: "req-2",
      userId: "user-1",
      status: "PENDING",
    } as any);

    const service = new ApprovalService(prismaMock);
    const result = await service.createRequest({
      userId: "user-1",
      provider: "slack",
      externalContext: { channelId: "c-1" },
      requestPayload: { actionType: "tool", description: "desc", args: {} },
      idempotencyKey: "idem-2",
      expiresInSeconds: 120,
    });

    expect(result.id).toBe("req-2");
    expect(prismaMock.approvalRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          provider: "slack",
          status: "PENDING",
          idempotencyKey: "idem-2",
        }),
      }),
    );
  });

  it("returns request with decisions in getRequest", async () => {
    const request = { id: "req-3" } as any;
    prismaMock.approvalRequest.findUnique.mockResolvedValue(request);

    const service = new ApprovalService(prismaMock);
    const result = await service.getRequest("req-3");

    expect(result).toBe(request);
    expect(prismaMock.approvalRequest.findUnique).toHaveBeenCalledWith({
      where: { id: "req-3" },
      include: { decisions: true },
    });
  });

  it("decides approval request and creates decision record", async () => {
    const now = new Date(Date.now() + 60_000);
    prismaMock.approvalRequest.findUnique.mockResolvedValue({
      id: "req-4",
      status: "PENDING",
      expiresAt: now,
    } as any);
    prismaMock.approvalRequest.update.mockResolvedValue({} as any);
    prismaMock.approvalDecision.create.mockResolvedValue({
      id: "dec-1",
      decision: "APPROVE",
    } as any);

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: PrismaClient) => unknown) =>
        callback(prismaMock as unknown as PrismaClient),
    );

    const service = new ApprovalService(prismaMock);
    const result = await service.decideRequest({
      approvalRequestId: "req-4",
      decidedByUserId: "user-1",
      decision: "APPROVE",
      reason: "ok",
    });

    expect(result.decision).toBe("APPROVE");
    expect(prismaMock.approvalRequest.update).toHaveBeenCalledWith({
      where: { id: "req-4" },
      data: { status: "APPROVED" },
    });
    expect(prismaMock.approvalDecision.create).toHaveBeenCalledWith({
      data: {
        approvalRequestId: "req-4",
        decidedByUserId: "user-1",
        decision: "APPROVE",
        decisionPayload: { reason: "ok" },
      },
    });
  });

  it("throws when request is expired", async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue({
      id: "req-5",
      status: "PENDING",
      expiresAt: new Date(Date.now() - 1000),
    } as any);
    prismaMock.approvalRequest.update.mockResolvedValue({} as any);
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: PrismaClient) => unknown) =>
        callback(prismaMock as unknown as PrismaClient),
    );

    const service = new ApprovalService(prismaMock);

    await expect(
      service.decideRequest({
        approvalRequestId: "req-5",
        decidedByUserId: "user-1",
        decision: "DENY",
      }),
    ).rejects.toThrow("Approval request has expired");

    expect(prismaMock.approvalRequest.update).toHaveBeenCalledWith({
      where: { id: "req-5" },
      data: { status: "EXPIRED" },
    });
  });
});
