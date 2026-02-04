
import { NextResponse } from "next/server";
import { executeScheduledAction } from "@/features/scheduled/executor";
import { createScopedLogger } from "@/server/lib/logger";
import prisma from "@/server/db/client";
import { createEmailProvider } from "@/features/email/provider";
import { env } from "@/env";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

export const maxDuration = 300; // 5 minutes

export const POST = verifySignatureAppRouter(async (req: Request) => {
    const logger = createScopedLogger("scheduled-actions/execute");

    // 1. Security Check (QStash or Cron Secret)
    // We reuse the cron secret check for now as QStash is configured to send it.
    // In strict prod, we should verify QStash signature.
    const authHeader = req.headers.get("authorization");
    if (!env.CRON_SECRET || authHeader !== `Bearer ${env.CRON_SECRET}`) {
        logger.warn("Unauthorized scheduled action attempt");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { scheduledActionId } = body;

        logger.info("Received scheduled action execution request", { scheduledActionId });

        if (!scheduledActionId) {
            return NextResponse.json({ error: "Missing scheduledActionId" }, { status: 400 });
        }

        // 2. Fetch the Action
        const scheduledAction = await prisma.scheduledAction.findUnique({
            where: { id: scheduledActionId },
        });

        if (!scheduledAction) {
            logger.warn("Scheduled action not found", { scheduledActionId });
            // Return 200 to prevent QStash retries if it's gone
            return NextResponse.json({ success: false, error: "Not found" });
        }

        if (scheduledAction.status === "COMPLETED" || scheduledAction.status === "CANCELLED") {
            logger.info("Scheduled action already finished", { status: scheduledAction.status });
            return NextResponse.json({ success: true, status: scheduledAction.status });
        }

        // 3. Hydrate Context (Email Provider)
        // executor needs a provider.
        // We need to fetch the account to create the provider.
        const emailAccount = await prisma.emailAccount.findUnique({
            where: { id: scheduledAction.emailAccountId },
            include: { account: true }
        });

        if (!emailAccount || !emailAccount.account) {
            logger.error("Email account not found for scheduled action", { emailAccountId: scheduledAction.emailAccountId });
            // Fail?
            return NextResponse.json({ success: false, error: "Email account missing" });
        }

        const provider = await createEmailProvider({
            emailAccountId: emailAccount.id,
            provider: emailAccount.account.provider,
            logger
        });

        // 4. Execute
        const result = await executeScheduledAction(scheduledAction, provider, logger);

        return NextResponse.json(result);

    } catch (error) {
        logger.error("Failed to execute scheduled action route", { error });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
