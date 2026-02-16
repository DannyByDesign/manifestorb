import { describe, expect, test, vi } from "vitest";
import {
  resolveScheduleProposalRequestById,
  type ScheduleProposalPayload,
} from "@/server/features/calendar/schedule-proposal";
import prisma from "@/server/lib/__mocks__/prisma";
import { executeStructuredApprovalAction } from "@/features/approvals/structured-execution";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client");
vi.mock("@/features/approvals/structured-execution", () => ({
  executeStructuredApprovalAction: vi.fn(),
}));

const TIMEOUT = 10_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

describe.runIf(isAiTest)("edge-case: group scheduling nightmare", () => {
  test(
    "proposes least-bad option when conflicts are dense",
    async () => {
      const requestPayload: ScheduleProposalPayload = {
        actionType: "schedule_proposal",
        description: "Schedule the group meeting",
        tool: "create",
        args: { data: { title: "Design team scheduling" } },
        originalIntent: "event",
        options: [
          { start: "2024-02-05T18:00:00Z", end: "2024-02-05T18:30:00Z", timeZone: "UTC" },
          { start: "2024-02-08T19:00:00Z", end: "2024-02-08T19:30:00Z", timeZone: "UTC" },
        ],
      };

      const requestRecord = {
        id: "req-group-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        requestPayload,
        user: {
          emailAccounts: [
            {
              id: "email-1",
              email: "user@example.com",
              provider: "google",
              account: {
                provider: "google",
              },
            },
          ],
        },
      } as any;

      prisma.approvalRequest.findUnique.mockResolvedValue(requestRecord);
      prisma.approvalRequest.update.mockResolvedValue({ id: "req-group-1" });

      vi.mocked(executeStructuredApprovalAction).mockResolvedValue({
        success: true,
        data: { ok: true },
      } as never);

      const res = await resolveScheduleProposalRequestById({
        requestId: "req-group-1",
        choiceIndex: 0,
      });

      expect(res.ok).toBe(true);
      expect(executeStructuredApprovalAction).toHaveBeenCalled();
    },
    TIMEOUT,
  );
});
