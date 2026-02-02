
import { NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/utils/logger";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

export const dynamic = 'force-dynamic';

// QStash signature verification ensures only QStash can call this endpoint
export const POST = verifySignatureAppRouter(async (req: Request) => {
    const logger = createScopedLogger("api/notifications/fallback");

    try {
        const body = await req.json();
        const { id } = body;

        if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

        logger.info("Processing fallback for notification", { id });

        // 1. Atomic Check-and-Set (The Race)
        // Only update IF it hasn't been claimed by Web AND hasn't been pushed yet.
        const result = await prisma.inAppNotification.updateMany({
            where: {
                id,
                claimedAt: null,       // Crucial: Web didn't take it
                pushedToSurface: false // Crucial: We didn't do it already
            },
            data: {
                pushedToSurface: true,
                pushedAt: new Date()
            }
        });

        // 2. Did we win?
        if (result.count === 0) {
            logger.info("Fallback skipped: Notification already claimed or pushed", { id });
            return NextResponse.json({ status: "skipped" });
        }

        // 3. We won -> Execute Push
        const notification = await prisma.inAppNotification.findUnique({ where: { id } });
        if (!notification) return NextResponse.json({ error: "Not found after update??" }, { status: 500 });

        // Import Router dynamically
        const { ChannelRouter } = await import("@/server/channels/router");
        const router = new ChannelRouter();

        const success = await router.pushMessage(notification.userId, notification.body || notification.title);

        logger.info("Fallback push executed", { id, success });

        return NextResponse.json({ status: "pushed", success });

    } catch (error) {
        logger.error("Fallback failed", { error });
        return NextResponse.json({ error: "Internal Error" }, { status: 500 });
    }
});
