import prisma from "@/server/db/client";
import { ApprovalService } from "@/features/approvals/service";
import { createScopedLogger } from "@/server/lib/logger";
import { executeStructuredApprovalAction } from "@/features/approvals/structured-execution";
import { resolvedSlotsSchema } from "@/server/features/ai/skills/contracts/slot-types";

const logger = createScopedLogger("approvals/execute");

type SkillExecutionResumePayload = {
  actionType: "skill_execution_resume";
  skillId: string;
  stepId: string;
  capability: string;
  description?: string;
  emailAccountId?: string;
  conversationId?: string;
  threadId?: string;
  messageId?: string;
  sourceEmailMessageId?: string;
  sourceEmailThreadId?: string;
  sourceCalendarEventId?: string;
  resume?: {
    resolvedSlots?: Record<string, unknown>;
    executionState?: {
      lastQueriedEmailIds?: string[];
      lastQueriedEmailItems?: unknown[];
      lastQueriedCalendarItems?: unknown[];
    };
  };
};

function mapCapabilityToApprovalTool(capability: string): "send" | "create" | "modify" | "delete" {
  if (
    capability === "email.sendNow" ||
    capability === "email.sendDraft" ||
    capability === "email.reply" ||
    capability === "email.forward"
  ) {
    return "send";
  }
  if (
    capability === "email.batchTrash" ||
    capability === "calendar.deleteEvent" ||
    capability === "email.deleteDraft"
  ) {
    return "delete";
  }
  if (
    capability === "email.createDraft" ||
    capability === "calendar.createEvent" ||
    capability === "calendar.createFocusBlock" ||
    capability === "calendar.createBookingSchedule"
  ) {
    return "create";
  }
  return "modify";
}

function parseSkillExecutionResumePayload(payload: {
  [key: string]: unknown;
}): SkillExecutionResumePayload | null {
  if (payload.actionType !== "skill_execution_resume") return null;
  if (
    typeof payload.skillId !== "string" ||
    payload.skillId.length === 0 ||
    typeof payload.stepId !== "string" ||
    payload.stepId.length === 0 ||
    typeof payload.capability !== "string" ||
    payload.capability.length === 0
  ) {
    return null;
  }
  return payload as unknown as SkillExecutionResumePayload;
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

    if (payload.actionType === "ambiguous_time") {
      throw new Error(
        "Ambiguous-time approvals require selecting earlier/later; use the ambiguous-time resolve endpoint.",
      );
    }

    if (payload.actionType === "skill_execution_resume") {
      const resumePayload = parseSkillExecutionResumePayload(payload as Record<string, unknown>);
      if (!resumePayload) {
        throw new Error("Invalid skill approval payload");
      }

      const { resolveEmailAccount } = await import("@/server/lib/user-utils");
      const emailAccount = resolveEmailAccount(request.user, resumePayload.emailAccountId);
      if (!emailAccount) {
        throw new Error("No email account found for skill approval execution");
      }

      const { getBaselineSkill } = await import("@/server/features/ai/skills/registry/baseline-registry");
      const { BASELINE_SKILL_IDS } = await import("@/server/features/ai/skills/baseline/skill-ids");
      const { executeSkill } = await import("@/server/features/ai/skills/executor/execute-skill");
      const { createCapabilities } = await import("@/server/features/ai/capabilities");
      const { loadSkillPolicyContext } = await import("@/server/features/ai/skills/policy/context");

      if (!BASELINE_SKILL_IDS.includes(resumePayload.skillId as (typeof BASELINE_SKILL_IDS)[number])) {
        throw new Error(`Unsupported skill in approval payload: ${resumePayload.skillId}`);
      }
      const skill = getBaselineSkill(
        resumePayload.skillId as (typeof BASELINE_SKILL_IDS)[number],
      );
      const resolvedSlotsRaw =
        resumePayload.resume?.resolvedSlots &&
        typeof resumePayload.resume.resolvedSlots === "object"
          ? (resumePayload.resume.resolvedSlots as Record<string, unknown>)
          : {};
      const parsedResolvedSlots = resolvedSlotsSchema.safeParse(resolvedSlotsRaw);
      const resolvedSlots = parsedResolvedSlots.success ? parsedResolvedSlots.data : {};
      const capabilities = await createCapabilities({
        userId: request.userId,
        emailAccountId: emailAccount.id,
        email: emailAccount.email,
        provider:
          (emailAccount as { account?: { provider?: string } }).account?.provider ??
          "google",
        logger,
        conversationId: resumePayload.conversationId,
        currentMessage:
          typeof resumePayload.description === "string"
            ? resumePayload.description
            : undefined,
        sourceEmailMessageId: resumePayload.sourceEmailMessageId,
        sourceEmailThreadId: resumePayload.sourceEmailThreadId,
      });
      const policyContext = await loadSkillPolicyContext(request.userId);

      const resumedExecution = await executeSkill({
        skill,
        slots: {
          resolved: resolvedSlots,
          missingRequired: [],
          ambiguous: [],
        },
        capabilities,
        runtime: {
          logger,
          emailAccount: {
            id: emailAccount.id,
            email: emailAccount.email,
            userId: request.userId,
          },
          policyContext,
          approvalContext: {
            provider: request.provider,
            conversationId: resumePayload.conversationId,
            threadId: resumePayload.threadId,
            messageId: resumePayload.messageId,
            sourceEmailMessageId: resumePayload.sourceEmailMessageId,
            sourceEmailThreadId: resumePayload.sourceEmailThreadId,
            sourceCalendarEventId: resumePayload.sourceCalendarEventId,
          },
        },
        resume: {
          approvedStepId: resumePayload.stepId,
          bypassPolicyForStepId: resumePayload.stepId,
          executeOnlyApprovedStep: true,
          initialState: resumePayload.resume?.executionState,
        },
      });

      if (
        resumedExecution.status !== "success" &&
        resumedExecution.status !== "partial"
      ) {
        throw new Error(
          `Approved action execution failed: ${
            resumedExecution.failureReason ?? resumedExecution.responseText
          }`,
        );
      }

      return {
        decisionRecord,
        executionResult: {
          success: true,
          message: resumedExecution.responseText,
          data: {
            status: resumedExecution.status,
            stepsExecuted: resumedExecution.stepsExecuted,
            capability: resumePayload.capability,
            stepId: resumePayload.stepId,
          },
        },
        toolName: mapCapabilityToApprovalTool(resumePayload.capability),
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
