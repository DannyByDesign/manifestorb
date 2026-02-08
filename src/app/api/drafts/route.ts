import { NextRequest, NextResponse } from "next/server";
import { createScopedLogger } from "@/server/lib/logger";
import { auth } from "@/server/auth";
import { listUserDrafts } from "@/features/drafts/service";

const logger = createScopedLogger("api/drafts");

/**
 * GET /api/drafts
 * 
 * List all drafts for the authenticated user.
 * Returns parsed messages with id, subject, to, snippet, date.
 */
export async function GET(req: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const maxResults = parseInt(url.searchParams.get("limit") || "50", 10);
    const emailAccountId = url.searchParams.get("emailAccountId") || undefined;

    try {
        const result = await listUserDrafts({
            userId: session.user.id,
            logger,
            emailAccountId,
            maxResults,
        });
        if (!result.success) {
            return NextResponse.json({ error: "Email account not found" }, { status: 404 });
        }
        return NextResponse.json({
            drafts: result.drafts,
            emailAccountId: result.emailAccountId,
            count: result.count,
        });

    } catch (err) {
        logger.error("Failed to list drafts", { error: err, userId: session.user.id });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to list drafts" },
            { status: 500 }
        );
    }
}
