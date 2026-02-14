import prisma from "@/server/db/client";
import { ApprovalService } from "@/features/approvals/service";
import { createScopedLogger } from "@/server/lib/logger";
import { executeStructuredApprovalAction } from "@/features/approvals/structured-execution";

const logger = createScopedLogger("approvals/execute");

type ToolExecutePayload = {
  actionType: "tool_execute";
  toolName: string;
  args?: Record<string, unknown>;
  description?: string;
  emailAccountId?: string;
  conversationId?: string;
  threadId?: string;
  messageId?: string;
  sourceEmailMessageId?: string;
  sourceEmailThreadId?: string;
  sourceCalendarEventId?: string;
};

type RuleActionExecutePayload = {
  actionType: "rule_action_execute";
  description?: string;
  tool?: string;
  args?: Record<string, unknown>;
  executedRuleId?: string;
  actionId?: string;
  emailAccountId?: string;
  messageId?: string;
  threadId?: string;
};

function mapToolToApprovalTool(toolName: string): "send" | "create" | "modify" | "delete" {
  if (
    toolName === "email.sendNow" ||
    toolName === "email.sendDraft" ||
    toolName === "email.reply" ||
    toolName === "email.forward"
  ) {
    return "send";
  }
  if (
    toolName === "email.batchTrash" ||
    toolName === "calendar.deleteEvent" ||
    toolName === "email.deleteDraft"
  ) {
    return "delete";
  }
  if (
    toolName === "email.createDraft" ||
    toolName === "calendar.createEvent" ||
    toolName === "calendar.createFocusBlock" ||
    toolName === "calendar.createBookingSchedule"
  ) {
    return "create";
  }
  return "modify";
}

function parseToolExecutePayload(payload: {
  [key: string]: unknown;
}): ToolExecutePayload | null {
  if (payload.actionType !== "tool_execute") return null;
  if (
    typeof payload.toolName !== "string" ||
    payload.toolName.length === 0
  ) {
    return null;
  }
  return payload as unknown as ToolExecutePayload;
}

function parseRuleActionExecutePayload(payload: {
  [key: string]: unknown;
}): RuleActionExecutePayload | null {
  if (payload.actionType !== "rule_action_execute") return null;
  if (
    typeof payload.executedRuleId !== "string" ||
    payload.executedRuleId.length === 0 ||
    typeof payload.actionId !== "string" ||
    payload.actionId.length === 0
  ) {
    return null;
  }
  return payload as unknown as RuleActionExecutePayload;
}

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

    if (payload.actionType === "rule_action_execute") {
      const ruleActionPayload = parseRuleActionExecutePayload(payload as Record<string, unknown>);
      if (!ruleActionPayload) {
        throw new Error("Invalid rule_action_execute approval payload");
      }

      const { resolveEmailAccount } = await import("@/server/lib/user-utils");
      const emailAccount = resolveEmailAccount(request.user, ruleActionPayload.emailAccountId);
      if (!emailAccount) {
        throw new Error("No email account found for rule action approval execution");
      }

      const executedRule = await prisma.executedRule.findUnique({
        where: { id: ruleActionPayload.executedRuleId },
        include: { actionItems: true },
      });
      if (!executedRule) {
        throw new Error("Executed rule not found for rule action approval execution");
      }

      const actionToRun = executedRule.actionItems.find(
        (action) => action.id === ruleActionPayload.actionId,
      );
      if (!actionToRun) {
        throw new Error("Rule action not found for approval execution");
      }

      const { createEmailProvider } = await import("@/features/email/provider");
      const { runActionFunction } = await import("@/features/ai/actions");
      const provider =
        (emailAccount as { account?: { provider?: string } }).account?.provider ?? "google";
      const emailProvider = await createEmailProvider({
        emailAccountId: emailAccount.id,
        provider,
        logger,
      });

      const messageId = ruleActionPayload.messageId ?? executedRule.messageId;
      const message = await emailProvider.getMessage(messageId);
      const executionResult = await runActionFunction({
        client: emailProvider,
        email: message,
        action: actionToRun,
        userEmail: emailAccount.email,
        userId: request.userId,
        emailAccountId: emailAccount.id,
        executedRule,
        logger,
        policyBypass: {
          approvalRequestId: request.id,
          reason: "approved_replay",
        },
      });

      return {
        decisionRecord,
        executionResult: {
          success: true,
          message: "Approved automation action executed.",
          data: executionResult,
        },
        toolName: typeof ruleActionPayload.tool === "string" ? ruleActionPayload.tool : "modify",
        request,
      };
    }

    if (payload.actionType === "ambiguous_time") {
      throw new Error(
        "Ambiguous-time approvals require selecting earlier/later; use the ambiguous-time resolve endpoint.",
      );
    }

    if (payload.actionType === "tool_execute") {
      const toolPayload = parseToolExecutePayload(payload as Record<string, unknown>);
      if (!toolPayload) {
        throw new Error("Invalid tool approval payload");
      }

      const { resolveEmailAccount } = await import("@/server/lib/user-utils");
      const emailAccount = resolveEmailAccount(request.user, toolPayload.emailAccountId);
      if (!emailAccount) {
        throw new Error("No email account found for tool approval execution");
      }

      const { createCapabilities } = await import("@/server/features/ai/tools/runtime/capabilities");
      const { executeRuntimeTool } = await import(
        "@/server/features/ai/tools/runtime/capabilities/execute"
      );
      const capabilities = await createCapabilities({
        userId: request.userId,
        emailAccountId: emailAccount.id,
        email: emailAccount.email,
        provider:
          (emailAccount as { account?: { provider?: string } }).account?.provider ??
          "google",
        logger,
        conversationId: toolPayload.conversationId,
        currentMessage:
          typeof toolPayload.description === "string"
            ? toolPayload.description
            : undefined,
        sourceEmailMessageId: toolPayload.sourceEmailMessageId,
        sourceEmailThreadId: toolPayload.sourceEmailThreadId,
      });

      const toolArgs =
        toolPayload.args &&
        typeof toolPayload.args === "object" &&
        !Array.isArray(toolPayload.args)
          ? (toolPayload.args as Record<string, unknown>)
          : {};

      const executionResult = await executeRuntimeTool({
        toolName: toolPayload.toolName as Parameters<
          typeof executeRuntimeTool
        >[0]["toolName"],
        args: toolArgs,
        capabilities,
      });

      if (!executionResult.success) {
        throw new Error(
          `Approved action execution failed: ${executionResult.error ?? executionResult.message ?? "tool execution failed"}`,
        );
      }

      return {
        decisionRecord,
        executionResult: {
          success: true,
          message: executionResult.message ?? "Approved action executed.",
          data: executionResult.data,
        },
        toolName: mapToolToApprovalTool(toolPayload.toolName),
        request,
      };
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
