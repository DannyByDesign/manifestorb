import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { createEmailProvider } from "@/features/email/provider";
import { resolveEmailAccount } from "@/server/lib/user-utils";

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
  args: Record<string, unknown>;
  originalIntent: "task" | "event";
  options: ScheduleProposalOption[];
  reason?: string;
  /** Fields added by SCHEDULE_MEETING action */
  draftId?: string;
  draftContent?: string;
  senderEmail?: string;
  messageId?: string;
  threadId?: string;
  emailAccountId?: string;
};

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
          emailAccounts: { include: { account: true } },
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
  const args: Record<string, unknown> = { ...(payload.args ?? {}) };
  const existingData = typeof args.data === "object" && args.data !== null ? args.data : {};
  const data: Record<string, unknown> = { ...(existingData as Record<string, unknown>) };

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

  const preferredId = payload.emailAccountId ?? undefined;
  const emailAccountRow = requestRecord.user
    ? resolveEmailAccount(requestRecord.user, preferredId)
    : null;
  if (!emailAccountRow) {
    return { ok: false, error: "No email account found" };
  }
  const linkedAccount = emailAccountRow as { account?: { provider?: string } | null };
  const provider = linkedAccount.account?.provider;
  if (!provider) {
    return { ok: false, error: "Email account has no linked provider" };
  }
  const emailAccountWithProvider = requestRecord.user.emailAccounts.find(
    (candidate) => candidate.id === emailAccountRow.id,
  );
  if (!emailAccountWithProvider) {
    return { ok: false, error: "Email account context missing for tool execution" };
  }
  const toolEmailAccount = {
    id: emailAccountRow.id,
    provider,
    access_token:
      (emailAccountWithProvider as { account?: { access_token?: string | null } })
        .account?.access_token ?? null,
    refresh_token:
      (emailAccountWithProvider as { account?: { refresh_token?: string | null } })
        .account?.refresh_token ?? null,
    expires_at: (() => {
      const raw = (
        emailAccountWithProvider as { account?: { expires_at?: Date | null } }
      ).account?.expires_at;
      return raw ? Math.floor(raw.getTime() / 1000) : null;
    })(),
    email: emailAccountRow.email,
  };

  try {
    const { createAgentTools } = await import("@/features/ai/tools");
    const tools = await createAgentTools({
      emailAccount: toolEmailAccount,
      logger,
      userId: requestRecord.userId,
    });
    const toolMap = tools as unknown as Record<
      string,
      { execute?: (a: Record<string, unknown>) => Promise<unknown> }
    >;
    const toolInstance = toolMap[payload.tool];
    if (!toolInstance || typeof toolInstance.execute !== "function") {
      return { ok: false, error: "Tool not found" };
    }

    const executionResult = await toolInstance.execute(args);

    // If the proposal was created by SCHEDULE_MEETING with a draft, send it
    let draftSent = false;
    if (payload.draftId && payload.emailAccountId) {
      try {
        const emailProvider = await createEmailProvider({
          emailAccountId: payload.emailAccountId,
          provider,
          logger,
        });

        // Update the draft with the confirmed time before sending
        const chosenSlot = option;
        const startDate = new Date(chosenSlot.start);
        const dateStr = startDate.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        });
        const startTime = startDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        });

        try {
          await emailProvider.updateDraft(payload.draftId, {
            messageHtml: [
              `Hi ${payload.senderEmail ?? ""},`,
              "",
              `I'd like to confirm our meeting for <strong>${dateStr} at ${startTime}</strong>.`,
              "",
              "A calendar invite is on its way. Looking forward to it!",
              "",
              "Best regards",
            ]
              .join("<br>"),
          });
        } catch (updateError) {
          logger.warn("Failed to update draft before sending", { updateError });
          // Continue to send the original draft even if update fails
        }

        await emailProvider.sendDraft(payload.draftId);
        draftSent = true;
        logger.info("SCHEDULE_MEETING: draft sent after slot approval", {
          draftId: payload.draftId,
        });
      } catch (draftError) {
        logger.warn("Failed to send draft after schedule approval", {
          draftError,
          draftId: payload.draftId,
        });
        // Don't fail the whole flow – calendar event was already created
      }
    }

    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED" },
    });

    return { ok: true, data: executionResult, draftSent };
  } catch (error) {
    logger.error("Failed to resolve schedule proposal", { error, requestId });
    return { ok: false, error: "Execution failed" };
  }
}
