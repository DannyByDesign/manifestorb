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

describe("E2E calendar scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves schedule proposal and executes create", async () => {
    const choice = parseScheduleProposalChoice("first", 2);
    expect(choice).toBe(0);

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
      choiceIndex: choice ?? 0,
    });

    expect(res.ok).toBe(true);
    expect(execute).toHaveBeenCalled();
  });
});
