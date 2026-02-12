import { NextRequest, NextResponse } from "next/server";
import { createScopedLogger } from "@/server/lib/logger";
import { auth } from "@/server/auth";
import { sendUserDraftById } from "@/features/drafts/service";
import { env } from "@/env";

const logger = createScopedLogger("api/drafts/send");

// Surfaces shared secret for authentication from external platforms
const SURFACES_SECRET = env.SURFACES_SHARED_SECRET;

/**
 * POST /api/drafts/:id/send
 * 
 * Sends a draft email.
 * Authentication: User session OR surfaces shared secret (with userId in body)
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id: draftId } = await context.params;

    // Check for surfaces authentication first
    const surfacesAuth = req.headers.get("x-surfaces-secret") || 
                         req.headers.get("authorization")?.replace("Bearer ", "");
    const isSurfacesAuth = SURFACES_SECRET && surfacesAuth === SURFACES_SECRET;

    let userId: string | undefined;
    let emailAccountId: string | undefined;

    if (isSurfacesAuth) {
        // Surfaces authentication - userId must be in body
        try {
            const body = await req.json();
            userId = body.userId;
            emailAccountId = body.emailAccountId;
        } catch {
            return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
        }

        if (!userId || !emailAccountId) {
            return NextResponse.json(
                { error: "userId and emailAccountId required for surfaces auth" },
                { status: 400 }
            );
        }
    } else {
        // Standard session authentication
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        userId = session.user.id;

        // Get emailAccountId from body or find user's primary account
        try {
            const body = await req.json().catch(() => ({}));
            emailAccountId = body.emailAccountId;
        } catch {
            // Body may be empty for web requests
        }
    }

    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const result = await sendUserDraftById({
            userId,
            draftId,
            logger,
            emailAccountId,
        });
        if (!result.success) {
            return NextResponse.json({ error: "Email account not found" }, { status: 404 });
        }

        // Send the draft
        logger.info("Sending draft", { draftId, userId, emailAccountId: result.emailAccountId });

        logger.info("Draft sent successfully", { 
            draftId, 
            messageId: result.messageId, 
            threadId: result.threadId 
        });

        return NextResponse.json({
            success: true,
            messageId: result.messageId,
            threadId: result.threadId
        });

    } catch (err) {
        if (err instanceof Error && err.message === "Draft not found") {
            return NextResponse.json({ error: "Draft not found" }, { status: 404 });
        }
        logger.error("Failed to send draft", { error: err, draftId, userId });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to send draft" },
            { status: 500 }
        );
    }
}
