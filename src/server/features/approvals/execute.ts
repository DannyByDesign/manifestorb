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

    const { resolveEmailAccount } = await import("@/server/lib/user-utils");
    const payloadEmailAccountId = payload.emailAccountId;
    const emailAccount = resolveEmailAccount(request.user, payloadEmailAccountId);
    if (!emailAccount) {
      throw new Error("No email account found for user during tool execution");
    }
    const emailAccountWithProvider = request.user.emailAccounts.find(
      (candidate) => candidate.id === emailAccount.id,
    );
    const provider = (emailAccountWithProvider as { account?: { provider?: string } })?.account?.provider;
    if (!provider) {
      throw new Error(`Email account ${emailAccount.id} is missing provider linkage`);
    }
    const toolEmailAccount = {
      id: emailAccount.id,
      provider,
      access_token: (emailAccountWithProvider as { account?: { access_token?: string | null } })?.account?.access_token ?? null,
      refresh_token: (emailAccountWithProvider as { account?: { refresh_token?: string | null } })?.account?.refresh_token ?? null,
      expires_at: (() => {
        const raw = (emailAccountWithProvider as { account?: { expires_at?: Date | null } })?.account?.expires_at;
        if (!raw) return null;
        return Math.floor(raw.getTime() / 1000);
      })(),
      email: emailAccount.email,
    };

    const toolName = payload.tool ?? "";
    const args = payload.args ?? {};

    const { createAgentTools } = await import("@/features/ai/tools");
    const tools = await createAgentTools({
      emailAccount: toolEmailAccount,
      logger,
      userId: request.userId,
    });

    const toolMap = tools as Record<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }>;
    const toolInstance = toolMap[toolName];
    if (!toolInstance) {
      throw new Error(`Tool ${toolName} not found in agent tools`);
    }

    const executionArgs = { ...args };
    const argsIds = Array.isArray((executionArgs as { ids?: unknown }).ids)
      ? ((executionArgs as { ids?: unknown }).ids as unknown[]).filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
      : [];

    const maxIdsPerRun = toolName === "delete" || toolName === "modify"
      ? 50
      : toolName === "get"
        ? 10
        : undefined;

    const isFailureResult = (result: unknown): boolean =>
      Boolean(
        result &&
          typeof result === "object" &&
          "success" in result &&
          (result as { success?: unknown }).success === false,
      );
    const getResultError = (result: unknown): string | undefined =>
      result &&
      typeof result === "object" &&
      "error" in result &&
      typeof (result as { error?: unknown }).error === "string"
        ? (result as { error?: string }).error
        : undefined;

    const executionResult =
      maxIdsPerRun && argsIds.length > maxIdsPerRun
        ? await (async () => {
          const baseArgs = { ...executionArgs } as Record<string, unknown>;
          delete baseArgs.ids;
          const chunkResults: Array<{
            chunkIndex: number;
            ids: string[];
            result: unknown;
          }> = [];

          for (let i = 0; i < argsIds.length; i += maxIdsPerRun) {
            const chunk = argsIds.slice(i, i + maxIdsPerRun);
            const chunkResult = await toolInstance.execute({
              ...baseArgs,
              ids: chunk,
            });
            chunkResults.push({
              chunkIndex: Math.floor(i / maxIdsPerRun),
              ids: chunk,
              result: chunkResult,
            });
          }

          const failedChunks = chunkResults.filter((entry) =>
            isFailureResult(entry.result),
          ).length;
          const firstFailedChunk = chunkResults.find((entry) =>
            isFailureResult(entry.result),
          );
          const firstFailedError = firstFailedChunk
            ? getResultError(firstFailedChunk.result)
            : undefined;

          return {
            success: failedChunks === 0,
            error:
              failedChunks > 0
                ? firstFailedError ?? "One or more chunk executions failed."
                : undefined,
            data: {
              chunkCount: chunkResults.length,
              failedChunks,
              chunks: chunkResults,
            },
            message:
              failedChunks === 0
                ? `Executed ${chunkResults.length} approval chunk(s).`
                : `Executed ${chunkResults.length - failedChunks}/${chunkResults.length} approval chunk(s).`,
          };
        })()
        : await toolInstance.execute(executionArgs as Record<string, unknown>);

    if (
      executionResult &&
      typeof executionResult === "object" &&
      "success" in executionResult &&
      (executionResult as { success?: unknown }).success === false
    ) {
      const executionError =
        "error" in executionResult && typeof (executionResult as { error?: unknown }).error === "string"
          ? (executionResult as { error?: string }).error
          : "Tool returned unsuccessful result";
      throw new Error(`Approved action execution failed: ${executionError}`);
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
