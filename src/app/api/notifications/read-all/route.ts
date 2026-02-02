/**
 * Mark All Notifications as Read API
 * 
 * POST /api/notifications/read-all
 * 
 * Marks all unread notifications as read for the authenticated user.
 * Useful for "Clear all" or "Mark all as read" functionality.
 */
import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { auth } from "@/server/lib/auth";
import { createScopedLogger } from "@/server/lib/logger";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const logger = createScopedLogger("api/notifications/read-all");

    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = session.user.id;

        const result = await prisma.inAppNotification.updateMany({
            where: {
                userId,
                isRead: false
            },
            data: {
                isRead: true,
                readAt: new Date()
            }
        });

        logger.info("All notifications marked as read", { userId, count: result.count });

        return NextResponse.json({ 
            success: true, 
            markedAsRead: result.count 
        });

    } catch (error) {
        logger.error("Failed to mark all notifications as read", { error });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
