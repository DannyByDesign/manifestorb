
import { NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { withQStashSignatureAppRouter } from "@/server/lib/qstash";

export const dynamic = 'force-dynamic';

// QStash signature verification ensures only QStash can call this endpoint
export const POST = withQStashSignatureAppRouter(async (req: Request) => {
    const logger = createScopedLogger("api/notifications/fallback");

    try {
        const body = await req.json();
        const { id } = body;

        if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

        logger.info("Processing fallback for notification", { id });

        // 1. Claim this notification for fallback delivery.
        const claimTime = new Date();
        const claimResult = await prisma.inAppNotification.updateMany({
            where: {
                id,
                claimedAt: null,       // Crucial: Web didn't take it
                pushedToSurface: false // Crucial: We didn't do it already
            },
            data: {
                claimedAt: claimTime
            }
        });

        // 2. Did we win the claim?
        if (claimResult.count === 0) {
            logger.info("Fallback skipped: Notification already claimed or pushed", { id });
            return NextResponse.json({ status: "skipped" });
        }

        // 3. We won -> Execute Push
        const notification = await prisma.inAppNotification.findUnique({ where: { id } });
        if (!notification) {
            await prisma.inAppNotification.updateMany({
                where: { id },
                data: { claimedAt: null },
            });
            return NextResponse.json({ error: "Notification not found" }, { status: 404 });
        }

        // Import Router dynamically
        const { ChannelRouter } = await import("@/features/channels/router");
        const router = new ChannelRouter();

        const success = await router.pushMessage(notification.userId, notification.body || notification.title);

        if (!success) {
            // Release claim so a later fallback retry can attempt delivery again.
            await prisma.inAppNotification.updateMany({
                where: {
                    id,
                    pushedToSurface: false,
                    claimedAt: {
                        gte: claimTime,
                        lt: new Date(claimTime.getTime() + 1),
                    },
                },
                data: { claimedAt: null },
            });
            logger.warn("Fallback push failed; claim released for retry", { id });
            return NextResponse.json({ status: "failed", success: false });
        }

        const markResult = await prisma.inAppNotification.updateMany({
            where: {
                id,
                pushedToSurface: false,
                claimedAt: {
                    gte: claimTime,
                    lt: new Date(claimTime.getTime() + 1),
                },
            },
            data: {
                pushedToSurface: true,
                pushedAt: new Date(),
            },
        });

        if (markResult.count === 0) {
            logger.info("Fallback push skipped marking: claim changed concurrently", { id });
            return NextResponse.json({ status: "skipped", success: true });
        }

        logger.info("Fallback push executed", { id, success });

        return NextResponse.json({ status: "pushed", success });

    } catch (error) {
        logger.error("Fallback failed", { error });
        return NextResponse.json({ error: "Internal Error" }, { status: 500 });
    }
});
