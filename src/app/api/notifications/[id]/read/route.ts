/**
 * Mark Notification as Read API
 * 
 * POST /api/notifications/[id]/read
 * 
 * Marks a single notification as read for the authenticated user.
 */
import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";

export const dynamic = 'force-dynamic';

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const logger = createScopedLogger("api/notifications/read");

    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        const userId = session.user.id;

        // Update notification if it belongs to this user
        const result = await prisma.inAppNotification.updateMany({
            where: {
                id,
                userId, // Security: only update own notifications
                isRead: false // Only update if not already read
            },
            data: {
                isRead: true,
                readAt: new Date()
            }
        });

        if (result.count === 0) {
            // Either not found, not owned by user, or already read
            const exists = await prisma.inAppNotification.findFirst({
                where: { id, userId }
            });

            if (!exists) {
                return NextResponse.json({ error: "Notification not found" }, { status: 404 });
            }

            // Already read - that's fine
            return NextResponse.json({ success: true, alreadyRead: true });
        }

        logger.info("Notification marked as read", { id, userId });

        return NextResponse.json({ success: true });

    } catch (error) {
        logger.error("Failed to mark notification as read", { error });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
