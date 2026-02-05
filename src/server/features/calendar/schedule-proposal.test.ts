import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  parseScheduleProposalChoice,
  resolveScheduleProposalRequestById,
} from "@/server/features/calendar/schedule-proposal";
import prisma from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");
vi.mock("@/features/ai/tools", () => ({
  createAgentTools: vi.fn(),
}));

import { createAgentTools } from "@/features/ai/tools";

describe("schedule proposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses schedule proposal choice", () => {
    expect(parseScheduleProposalChoice("1", 3)).toBe(0);
    expect(parseScheduleProposalChoice("first option", 3)).toBe(0);
    expect(parseScheduleProposalChoice("latest", 3)).toBe(2);
    expect(parseScheduleProposalChoice("none", 3)).toBeNull();
  });

  it("returns error when request not found", async () => {
    prisma.approvalRequest.findUnique.mockResolvedValue(null);
    const res = await resolveScheduleProposalRequestById({
      requestId: "req-1",
      choiceIndex: 0,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Request not found");
  });

  it("executes tool and updates request", async () => {
    prisma.approvalRequest.findUnique.mockResolvedValue({
      id: "req-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
      requestPayload: {
        actionType: "schedule_proposal",
        tool: "create",
        args: { data: {} },
        originalIntent: "event",
        options: [{ start: "2024-01-01T10:00:00Z", end: "2024-01-01T11:00:00Z", timeZone: "UTC" }],
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
    expect(prisma.approvalRequest.update).toHaveBeenCalledWith({
      where: { id: "req-1" },
      data: { status: "APPROVED" },
    });
  });
});
