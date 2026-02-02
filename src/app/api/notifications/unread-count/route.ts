/**
 * Unread Notification Count API
 * 
 * GET /api/notifications/unread-count
 * 
 * Returns the count of unread notifications for the authenticated user.
 * Useful for displaying a badge in the UI.
 */
import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { auth } from "@/server/lib/auth";
import { createScopedLogger } from "@/server/lib/logger";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const logger = createScopedLogger("api/notifications/unread-count");

    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = session.user.id;

        const count = await prisma.inAppNotification.count({
            where: {
                userId,
                isRead: false
            }
        });

        return NextResponse.json({ count });

    } catch (error) {
        logger.error("Failed to get unread count", { error });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
