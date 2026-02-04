import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("schedule-proposal");

export type ScheduleProposalOption = {
  start: string;
  end?: string;
  timeZone: string;
};

export type ScheduleProposalPayload = {
  actionType: "schedule_proposal";
  description: string;
  tool: "create";
  args: Record<string, any>;
  originalIntent: "task" | "event";
  options: ScheduleProposalOption[];
  reason?: string;
};

export function parseScheduleProposalChoice(message: string, optionsCount: number) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return null;

  const directMatch = normalized.match(/\b(1|2|3)\b/);
  if (directMatch) {
    const index = Number(directMatch[1]) - 1;
    return index >= 0 && index < optionsCount ? index : null;
  }

  if (optionsCount >= 2) {
    if (/\b(first|earlier|earliest)\b/.test(normalized)) return 0;
    if (/\b(last|latest|later)\b/.test(normalized)) return optionsCount - 1;
  }

  return null;
}

export async function getPendingScheduleProposal(userId: string) {
  return prisma.approvalRequest.findFirst({
    where: {
      userId,
      status: "PENDING",
      expiresAt: { gt: new Date() },
      requestPayload: {
        path: ["actionType"],
        equals: "schedule_proposal",
      } as any,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function resolveScheduleProposalRequestById(params: {
  requestId: string;
  choiceIndex: number;
  userId?: string;
}) {
  const { requestId, choiceIndex, userId } = params;

  const requestRecord = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: {
      user: {
        include: {
          emailAccounts: { take: 1, include: { account: true } },
        },
      },
    },
  });

  if (!requestRecord) {
    return { ok: false, error: "Request not found" };
  }

  if (userId && requestRecord.userId !== userId) {
    return { ok: false, error: "Forbidden" };
  }

  if (requestRecord.expiresAt && new Date() > requestRecord.expiresAt) {
    return { ok: false, error: "Request expired" };
  }

  const payload = requestRecord.requestPayload as ScheduleProposalPayload;
  if (!payload || payload.actionType !== "schedule_proposal") {
    return { ok: false, error: "Invalid request payload" };
  }

  if (choiceIndex < 0 || choiceIndex >= payload.options.length) {
    return { ok: false, error: "Invalid choice" };
  }

  const option = payload.options[choiceIndex];
  const args = payload.args ?? {};
  const data = { ...(args.data || {}) };

  if (payload.originalIntent === "task") {
    data.scheduledStart = option.start;
    data.scheduledEnd = option.end ?? data.scheduledEnd;
    data.isAutoScheduled = true;
  } else {
    data.start = option.start;
    data.end = option.end ?? data.end;
    data.autoSchedule = false;
  }

  args.data = data;

  const emailAccount = requestRecord.user?.emailAccounts?.[0];
  if (!emailAccount) {
    return { ok: false, error: "No email account found" };
  }

  try {
    const { createAgentTools } = await import("@/features/ai/tools");
    const tools = await createAgentTools({
      emailAccount: emailAccount as any,
      logger,
      userId: requestRecord.userId,
    });
    const toolInstance = (tools as any)[payload.tool];
    if (!toolInstance) {
      return { ok: false, error: "Tool not found" };
    }

    const executionResult = await toolInstance.execute(args);

    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED" },
    });

    return { ok: true, data: executionResult };
  } catch (error) {
    logger.error("Failed to resolve schedule proposal", { error, requestId });
    return { ok: false, error: "Execution failed" };
  }
}
