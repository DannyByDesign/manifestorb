import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveScheduleProposalRequestById } from "@/server/features/calendar/schedule-proposal";
import prisma from "@/server/lib/__mocks__/prisma";
import type { Prisma } from "@/generated/prisma/client";

vi.mock("@/server/db/client");
vi.mock("@/features/ai/tools", () => ({
  createAgentTools: vi.fn(),
}));

import { createAgentTools } from "@/features/ai/tools";

describe("E2E calendar scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves schedule proposal and executes create", async () => {
    prisma.approvalRequest.findUnique.mockResolvedValue({
      id: "req-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
      requestPayload: {
        actionType: "schedule_proposal",
        tool: "create",
        args: { data: { title: "Meet" } },
        originalIntent: "event",
        options: [
          { start: "2024-01-01T10:00:00Z", end: "2024-01-01T11:00:00Z", timeZone: "UTC" },
          { start: "2024-01-02T10:00:00Z", end: "2024-01-02T11:00:00Z", timeZone: "UTC" },
        ],
      },
      user: { emailAccounts: [{ id: "email-1", account: { provider: "google" } }] },
    } as any);
    prisma.approvalRequest.update.mockResolvedValue({} as any);

    const execute = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(createAgentTools).mockResolvedValue({ create: { execute } } as any);

    const res = await resolveScheduleProposalRequestById({
      requestId: "req-1",
      choiceIndex: 0,
    });

    expect(res.ok).toBe(true);
    expect(execute).toHaveBeenCalled();
  });

  it("resolves schedule proposal with multi-party constraints", async () => {
    const requestRecord = {
      id: "req-2",
      userId: "user-2",
      expiresAt: new Date(Date.now() + 60_000),
      requestPayload: {
        actionType: "schedule_proposal",
        tool: "create",
        args: { data: { title: "ExecClientSync" } },
        originalIntent: "event",
        options: [
          { start: "2024-01-03T16:00:00Z", end: "2024-01-03T17:00:00Z", timeZone: "UTC" },
          { start: "2024-01-04T20:00:00Z", end: "2024-01-04T21:00:00Z", timeZone: "UTC" },
        ],
      },
      user: { emailAccounts: [{ id: "email-2", account: { provider: "google" } }] },
    } as unknown as Prisma.ApprovalRequest;

    prisma.approvalRequest.findUnique.mockResolvedValue(requestRecord);
    prisma.approvalRequest.update.mockResolvedValue({} as unknown as Prisma.ApprovalRequest);

    const execute = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(createAgentTools).mockResolvedValue(
      { create: { execute } } as unknown as { create: { execute: typeof execute } },
    );

    const res = await resolveScheduleProposalRequestById({
      requestId: "req-2",
      choiceIndex: 1,
    });

    expect(res.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "ExecClientSync",
          start: "2024-01-04T20:00:00Z",
          end: "2024-01-04T21:00:00Z",
        }),
      }),
    );
  });
});
