import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import { verifyApprovalActionToken } from "@/features/approvals/action-token";

type ApprovalAuthFailure = {
  ok: false;
  status: number;
  error: string;
};

type ApprovalDecisionAuthSuccess = {
  ok: true;
  approvalUserId: string;
  actingUserId: string;
};

type ApprovalViewAuthSuccess = {
  ok: true;
  approvalUserId: string;
};

type ApprovalDecisionAction = "approve" | "deny";

async function getApprovalRequestOwner(
  approvalRequestId: string,
): Promise<{ userId: string } | null> {
  return prisma.approvalRequest.findUnique({
    where: { id: approvalRequestId },
    select: { userId: true },
  });
}

export async function authorizeApprovalDecision({
  approvalRequestId,
  expectedAction,
  sessionUserId,
  token,
  logger,
}: {
  approvalRequestId: string;
  expectedAction: ApprovalDecisionAction;
  sessionUserId?: string;
  token?: string | null;
  logger: Logger;
}): Promise<ApprovalAuthFailure | ApprovalDecisionAuthSuccess> {
  const approvalRequest = await getApprovalRequestOwner(approvalRequestId);
  if (!approvalRequest) {
    return { ok: false, status: 404, error: "Approval request not found" };
  }

  const tokenPayload = token ? verifyApprovalActionToken(token) : null;
  if (tokenPayload && tokenPayload.action !== expectedAction) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  if (tokenPayload && tokenPayload.approvalId !== approvalRequestId) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  if (!sessionUserId && !tokenPayload) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  if (sessionUserId && approvalRequest.userId !== sessionUserId) {
    logger.warn("User attempted to decide another user's approval", {
      approvalRequestId,
      requestUserId: approvalRequest.userId,
      sessionUserId,
      expectedAction,
    });
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return {
    ok: true,
    approvalUserId: approvalRequest.userId,
    actingUserId: sessionUserId || approvalRequest.userId,
  };
}

export async function authorizeApprovalView({
  approvalRequestId,
  sessionUserId,
  logger,
}: {
  approvalRequestId: string;
  sessionUserId?: string;
  logger: Logger;
}): Promise<ApprovalAuthFailure | ApprovalViewAuthSuccess> {
  if (!sessionUserId) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const approvalRequest = await getApprovalRequestOwner(approvalRequestId);
  if (!approvalRequest) {
    return { ok: false, status: 404, error: "Approval request not found" };
  }

  if (approvalRequest.userId !== sessionUserId) {
    logger.warn("User attempted to view another user's approval", {
      approvalRequestId,
      requestUserId: approvalRequest.userId,
      sessionUserId,
    });
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true, approvalUserId: approvalRequest.userId };
}
