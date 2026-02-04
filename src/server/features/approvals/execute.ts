import prisma from "@/server/db/client";
import { ApprovalService } from "@/features/approvals/service";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("approvals/execute");

export async function executeApprovalRequest(params: {
  approvalRequestId: string;
  decidedByUserId: string;
  reason?: string;
}) {
  const { approvalRequestId, decidedByUserId, reason } = params;
  const service = new ApprovalService(prisma);

  const decisionRecord = await service.decideRequest({
    approvalRequestId,
    decidedByUserId,
    decision: "APPROVE",
    reason,
  });

  if (decisionRecord.decision !== "APPROVE") {
    return { decisionRecord };
  }

  const request = await prisma.approvalRequest.findUnique({
    where: { id: approvalRequestId },
    include: {
      user: {
        include: {
          emailAccounts: { take: 1, include: { account: true } },
        },
      },
    },
  });

  if (!request || !request.user) {
    throw new Error("Approval request or user not found");
  }

  const emailAccount = request.user.emailAccounts[0];
  if (!emailAccount) {
    throw new Error("No email account found for user during tool execution");
  }

  const payload = request.requestPayload as { tool: string; args: any };
  const { tool: toolName, args } = payload;

  const { createAgentTools } = await import("@/features/ai/tools");
  const tools = await createAgentTools({
    emailAccount: emailAccount as any,
    logger,
    userId: request.userId,
  });

  const toolInstance = (tools as any)[toolName];
  if (!toolInstance) {
    throw new Error(`Tool ${toolName} not found in agent tools`);
  }

  const executionResult = await toolInstance.execute(args);

  return {
    decisionRecord,
    executionResult,
    toolName,
    request,
  };
}
