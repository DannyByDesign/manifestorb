import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { env } from "@/env";
import { createEmailProvider } from "@/features/email/provider";
import { sendDraftById } from "@/features/drafts/operations";
import { withQStashSignatureAppRouter } from "@/server/lib/qstash";

const logger = createScopedLogger("api/drafts/schedule-send/execute");

const bodySchema = z.object({
  scheduleId: z.string().min(1).optional(),
  emailAccountId: z.string().min(1),
  draftId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

export const POST = withQStashSignatureAppRouter(async (req: Request) => {
  const authHeader = req.headers.get("authorization");
  if (!env.CRON_SECRET || authHeader !== `Bearer ${env.CRON_SECRET}`) {
    logger.warn("Unauthorized scheduled draft send attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rawBody = await req.json();
    const parseResult = bodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 },
      );
    }

    const { scheduleId, idempotencyKey } = parseResult.data;

    let emailAccountId = parseResult.data.emailAccountId;
    let draftId = parseResult.data.draftId;

    if (scheduleId) {
      const scheduled = await prisma.scheduledDraftSend.findUnique({
        where: { id: scheduleId },
        select: {
          id: true,
          emailAccountId: true,
          draftId: true,
          status: true,
        },
      });

      if (!scheduled) {
        logger.warn("Scheduled draft row not found", {
          scheduleId,
          emailAccountId,
          draftId,
          idempotencyKey: idempotencyKey ?? null,
        });
        return NextResponse.json(
          { success: false, error: "SCHEDULE_NOT_FOUND", scheduleId },
          { status: 404 },
        );
      }

      emailAccountId = scheduled.emailAccountId;
      draftId = scheduled.draftId;

      const lock = await prisma.scheduledDraftSend.updateMany({
        where: {
          id: scheduleId,
          status: { in: ["PENDING", "FAILED"] },
        },
        data: {
          status: "SENDING",
          lastError: null,
        },
      });

      if (lock.count === 0) {
        const current = await prisma.scheduledDraftSend.findUnique({
          where: { id: scheduleId },
          select: {
            status: true,
            messageId: true,
            threadId: true,
            sentAt: true,
          },
        });
        if (current?.status === "SENT") {
          return NextResponse.json({
            success: true,
            deduped: true,
            scheduleId,
            status: "SENT",
            draftId,
            messageId: current.messageId ?? null,
            threadId: current.threadId ?? null,
            sentAt: current.sentAt?.toISOString() ?? null,
          });
        }

        return NextResponse.json(
          {
            success: false,
            error: "SCHEDULE_NOT_EXECUTABLE",
            scheduleId,
            status: current?.status ?? "UNKNOWN",
          },
          { status: 409 },
        );
      }
    }

    const emailAccount = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      include: { account: { select: { provider: true } } },
    });

    if (!emailAccount?.account?.provider) {
      logger.warn("Email account not found for scheduled draft send", {
        emailAccountId,
        draftId,
      });
      return NextResponse.json(
        { success: false, error: "EMAIL_ACCOUNT_NOT_FOUND" },
        { status: 404 },
      );
    }

    const provider = await createEmailProvider({
      emailAccountId: emailAccount.id,
      provider: emailAccount.account.provider,
      logger,
    });

    try {
      const result = await sendDraftById({
        provider,
        draftId,
        requireExisting: true,
      });

      if (scheduleId) {
        await prisma.scheduledDraftSend.update({
          where: { id: scheduleId },
          data: {
            status: "SENT",
            sentAt: new Date(),
            messageId: result.messageId,
            threadId: result.threadId,
            lastError: null,
          },
        });
      }

      logger.info("Scheduled draft sent", {
        scheduleId: scheduleId ?? null,
        emailAccountId,
        draftId,
        idempotencyKey: idempotencyKey ?? null,
        messageId: result.messageId,
        threadId: result.threadId,
      });

      return NextResponse.json({
        success: true,
        scheduleId: scheduleId ?? null,
        status: scheduleId ? "SENT" : undefined,
        draftId,
        messageId: result.messageId,
        threadId: result.threadId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (scheduleId) {
        await prisma.scheduledDraftSend.update({
          where: { id: scheduleId },
          data: {
            status: "FAILED",
            lastError: message,
          },
        });
      }
      logger.error("Scheduled draft send failed", {
        scheduleId: scheduleId ?? null,
        emailAccountId,
        draftId,
        error: message,
      });
      return NextResponse.json(
        {
          success: false,
          error: message,
          scheduleId: scheduleId ?? null,
          status: scheduleId ? "FAILED" : undefined,
        },
        { status: 500 },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Scheduled draft send failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
