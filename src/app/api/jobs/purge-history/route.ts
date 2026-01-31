
import { NextResponse } from "next/server";
import prisma from "@/server/db/client";

export async function POST(req: Request) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${process.env.JOBS_SHARED_SECRET}`) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    // Purge logic: Find messages older than retentionDays for each user?
    // Doing it efficiently in SQL:
    // DELETE FROM "ConversationMessage" cm
    // USING "PrivacySettings" ps
    // WHERE cm."userId" = ps."userId"
    // AND cm."createdAt" < NOW() - (ps."retentionDays" || ' days')::interval

    // Prisma doesn't support generic complex deletes easily across relations in one query without raw.
    // Let's iterate or use raw SQL. Raw is safest for bulk.

    const deletedCount = await prisma.$executeRaw`
        DELETE FROM "ConversationMessage" cm
        USING "PrivacySettings" ps
        WHERE cm."userId" = ps."userId"
        AND cm."createdAt" < (NOW() - (ps."retentionDays" * INTERVAL '1 day'))
    `;

    return NextResponse.json({ success: true, deleted: deletedCount });
}
