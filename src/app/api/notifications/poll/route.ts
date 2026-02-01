
import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { auth } from "@/server/utils/auth";
import { createScopedLogger } from "@/server/utils/logger";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const logger = createScopedLogger("api/notifications/poll");

    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = session.user.id;

        // 1. Find Claimable Notifications (Unclaimed AND Unpushed)
        // We only fetch what we can "lock" to prevent race conditions.
        // Actually, for "Poll", we can fetch first, but to be strictly atomic we should update.
        // But `updateMany` doesn't return the records in Prisma easily (unless we use returns).
        // Standard pattern: Find IDs -> UpdateMany IDs -> Return those IDs.

        const claimable = await prisma.inAppNotification.findMany({
            where: {
                userId,
                claimedAt: null,
                pushedToSurface: false
            },
            select: { id: true }
        });

        if (claimable.length === 0) {
            return NextResponse.json({ notifications: [] });
        }

        const ids = claimable.map(n => n.id);

        // 2. Atomic Claim
        await prisma.inAppNotification.updateMany({
            where: { id: { in: ids } },
            data: { claimedAt: new Date() }
        });

        // 3. Fetch Full Data to return
        // We fetch *all* that we just claimed.
        // Technically strict atomicity could race here (claimed but pushed?), 
        // but our fallback worker respects 'claimedAt', so it won't push.
        const notifications = await prisma.inAppNotification.findMany({
            where: { id: { in: ids } },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({ notifications });

    } catch (error) {
        logger.error("Failed to poll notifications", { error });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
