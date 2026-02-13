import prisma from "@/server/db/client";
import { ApprovalService } from "@/features/approvals/service";
import { createScopedLogger } from "@/server/lib/logger";
import { executeStructuredApprovalAction } from "@/features/approvals/structured-execution";

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
  const resetApprovalToPending = async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Approval execution failed after decision; resetting request to PENDING", {
      approvalRequestId,
      decisionRecordId: decisionRecord.id,
      error: message,
    });
    await prisma.$transaction(async (tx) => {
      await tx.approvalDecision.deleteMany({
        where: {
          id: decisionRecord.id,
          approvalRequestId,
        },
      });
      await tx.approvalRequest.update({
        where: { id: approvalRequestId },
        data: { status: "PENDING" },
      });
    });
  };

  try {
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

    if (payload.actionType === "calendar_auto_reschedule") {
      const { resolveEmailAccount } = await import("@/server/lib/user-utils");
      const emailAccount = resolveEmailAccount(request.user, payload.emailAccountId);
      if (!emailAccount) {
        throw new Error("No email account found for calendar_auto_reschedule");
      }

      const executionResult = await executeStructuredApprovalAction({
        tool: "modify",
        args: payload.args ?? {},
        userId: request.userId,
        emailAccountId: emailAccount.id,
        logger,
      });
      if (!executionResult.success) {
        throw new Error(
          `Approved action execution failed: ${executionResult.error ?? "calendar_auto_reschedule failed"}`,
        );
      }

      return {
        decisionRecord,
        executionResult,
        toolName: "modify",
        request,
      };
    }

    if (payload.actionType === "schedule_proposal") {
      throw new Error(
        "Schedule proposals require an explicit slot selection; use the schedule-proposal resolve endpoint.",
      );
    }

    if (payload.actionType === "ambiguous_time") {
      throw new Error(
        "Ambiguous-time approvals require selecting earlier/later; use the ambiguous-time resolve endpoint.",
      );
    }

    const { resolveEmailAccount } = await import("@/server/lib/user-utils");
    const payloadEmailAccountId = payload.emailAccountId;
    const emailAccount = resolveEmailAccount(request.user, payloadEmailAccountId);
    if (!emailAccount) {
      throw new Error("No email account found for user during tool execution");
    }
    const toolName = payload.tool;
    if (toolName !== "create" && toolName !== "modify") {
      throw new Error(`Unsupported legacy approval tool: ${toolName ?? "unknown"}`);
    }

    const executionResult = await executeStructuredApprovalAction({
      tool: toolName,
      args: payload.args ?? {},
      userId: request.userId,
      emailAccountId: emailAccount.id,
      logger,
    });
    if (!executionResult.success) {
      throw new Error(
        `Approved action execution failed: ${executionResult.error ?? "structured execution failed"}`,
      );
    }

    return {
      decisionRecord,
      executionResult,
      toolName,
      request,
    };
  } catch (error) {
    await resetApprovalToPending(error);
    throw error;
  }
}
