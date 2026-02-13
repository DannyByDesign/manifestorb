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
  emailAccountId: z.string().min(1),
  draftId: z.string().min(1),
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

    const { emailAccountId, draftId } = parseResult.data;

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

    const result = await sendDraftById({
      provider,
      draftId,
      requireExisting: true,
    });

    logger.info("Scheduled draft sent", {
      emailAccountId,
      draftId,
      messageId: result.messageId,
      threadId: result.threadId,
    });

    return NextResponse.json({
      success: true,
      draftId,
      messageId: result.messageId,
      threadId: result.threadId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Scheduled draft send failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

