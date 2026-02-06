
import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const logger = createScopedLogger("api/notifications/history");

    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const notifications = await prisma.inAppNotification.findMany({
            where: { userId: session.user.id },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        return NextResponse.json({ notifications });

    } catch (error) {
        logger.error("Failed to fetch notification history", { error });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
