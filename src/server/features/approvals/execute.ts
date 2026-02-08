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
          emailAccounts: { include: { account: true } },
        },
      },
    },
  });

  if (!request || !request.user) {
    throw new Error("Approval request or user not found");
  }

  const payload = request.requestPayload as {
    actionType?: string;
    tool?: string;
    args?: Record<string, unknown>;
    draftId?: string;
    emailAccountId?: string;
  };

  if (payload.actionType === "batch_reschedule_tasks") {
    const tasks = (payload.args as { tasks?: Array<{ taskId: string; newStart: string | null; newEnd: string | null }> })?.tasks ?? (payload as { tasks?: Array<{ taskId: string; newStart: string | null; newEnd: string | null }> }).tasks ?? [];
    const results = await Promise.all(
      tasks.map(async (t) => {
        try {
          await prisma.task.update({
            where: { id: t.taskId },
            data: {
              scheduledStart: t.newStart ? new Date(t.newStart) : undefined,
              scheduledEnd: t.newEnd ? new Date(t.newEnd) : undefined,
              lastScheduled: new Date(),
            },
          });
          return { taskId: t.taskId, success: true };
        } catch (error) {
          return { taskId: t.taskId, success: false, error: String(error) };
        }
      }),
    );
    const succeeded = results.filter((r) => r.success).length;
    return {
      decisionRecord,
      executionResult: {
        success: succeeded === results.length,
        message: `Rescheduled ${succeeded}/${results.length} tasks.`,
        details: results,
      },
      toolName: "batch_reschedule",
      request,
    };
  }

  if (payload.actionType === "send_draft" && payload.draftId) {
    const { resolveEmailAccount } = await import("@/server/lib/user-utils");
    const emailAccount = resolveEmailAccount(request.user, payload.emailAccountId);
    if (!emailAccount) {
      throw new Error("No email account found for send_draft");
    }
    const { createEmailProvider } = await import("@/features/email/provider");
    const provider = (emailAccount as { account?: { provider?: string } }).account?.provider ?? "google";
    const emailProvider = await createEmailProvider({
      emailAccountId: emailAccount.id,
      provider,
      logger,
    });
    const executionResult = await emailProvider.sendDraft(payload.draftId);
    return {
      decisionRecord,
      executionResult: { success: true, data: executionResult, message: "Email sent." },
      toolName: "send",
      request,
    };
  }

  const { resolveEmailAccount } = await import("@/server/lib/user-utils");
  const payloadEmailAccountId = payload.emailAccountId;
  const emailAccount = resolveEmailAccount(request.user, payloadEmailAccountId);
  if (!emailAccount) {
    throw new Error("No email account found for user during tool execution");
  }

  const toolName = payload.tool ?? "";
  const args = payload.args ?? {};

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

  const executionArgs = {
    ...args,
    preApproved: true,
    approvalId: approvalRequestId,
  };
  const executionResult = await toolInstance.execute(executionArgs);

  return {
    decisionRecord,
    executionResult,
    toolName,
    request,
  };
}
