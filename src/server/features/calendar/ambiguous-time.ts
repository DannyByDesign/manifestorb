import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("ambiguous-time");

export async function resolveAmbiguousTimeRequestById(params: {
  requestId: string;
  choice: "earlier" | "later";
  userId?: string;
}) {
  const { requestId, choice, userId } = params;

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

  const payload = requestRecord.requestPayload as {
    actionType: string;
    tool: "create" | "modify";
    args: any;
    options: {
      earlier: { start: string; end?: string };
      later: { start: string; end?: string };
      timeZone: string;
    };
  };

  if (!payload || payload.actionType !== "ambiguous_time") {
    return { ok: false, error: "Invalid request payload" };
  }

  const option = choice === "earlier" ? payload.options.earlier : payload.options.later;
  const args = payload.args ?? {};

  if (payload.tool === "create") {
    args.data = {
      ...(args.data || {}),
      start: option.start,
      end: option.end ?? args.data?.end,
      ambiguityResolved: true,
    };
  } else {
    args.changes = {
      ...(args.changes || {}),
      start: option.start,
      end: option.end ?? args.changes?.end,
      ambiguityResolved: true,
    };
  }

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
    logger.error("Failed to resolve ambiguous time request", { error, requestId });
    return { ok: false, error: "Execution failed" };
  }
}
