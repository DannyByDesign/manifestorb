import { NextRequest, NextResponse } from "next/server";
import { createScopedLogger } from "@/server/lib/logger";
import { auth } from "@/server/auth";
import {
    deleteUserDraftById,
    getUserDraftById,
} from "@/features/drafts/service";
import { env } from "@/env";

const logger = createScopedLogger("api/drafts");

// Surfaces shared secret for authentication from external platforms
const SURFACES_SECRET = env.SURFACES_SHARED_SECRET;

/**
 * GET /api/drafts/:id
 * 
 * Get draft details
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id: draftId } = await context.params;

    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const result = await getUserDraftById({
            userId: session.user.id,
            draftId,
            logger,
        });
        if (!result.success && result.error === "EMAIL_ACCOUNT_NOT_FOUND") {
            return NextResponse.json({ error: "Email account not found" }, { status: 404 });
        }
        if (!result.success && result.error === "DRAFT_NOT_FOUND") {
            return NextResponse.json({ error: "Draft not found" }, { status: 404 });
        }
        if (!result.success) {
            return NextResponse.json({ error: "Failed to load draft" }, { status: 400 });
        }

        return NextResponse.json({ draft: result.draft });
    } catch (err) {
        logger.error("Failed to get draft", { error: err, draftId });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to get draft" },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/drafts/:id
 * 
 * Discard (delete) a draft email.
 * Authentication: User session OR surfaces shared secret (with userId in body)
 */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id: draftId } = await context.params;

    // Check for surfaces authentication first
    const surfacesAuth = req.headers.get("x-surfaces-secret") || 
                         req.headers.get("authorization")?.replace("Bearer ", "");
    const isSurfacesAuth = SURFACES_SECRET && surfacesAuth === SURFACES_SECRET;

    let userId: string | undefined;
    let emailAccountId: string | undefined;

    if (isSurfacesAuth) {
        // Surfaces authentication - userId must be in body or query
        const url = new URL(req.url);
        userId = url.searchParams.get("userId") || undefined;
        emailAccountId = url.searchParams.get("emailAccountId") || undefined;

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

        // Get emailAccountId from query params
        const url = new URL(req.url);
        emailAccountId = url.searchParams.get("emailAccountId") || undefined;
    }

    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const result = await deleteUserDraftById({
            userId,
            draftId,
            logger,
            emailAccountId,
        });
        if (!result.success) {
            return NextResponse.json({ error: "Email account not found" }, { status: 404 });
        }

        // Delete the draft
        logger.info("Discarding draft", { draftId, userId, emailAccountId: result.emailAccountId });

        logger.info("Draft discarded successfully", { draftId });

        return NextResponse.json({ success: true });

    } catch (err) {
        logger.error("Failed to discard draft", { error: err, draftId, userId });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to discard draft" },
            { status: 500 }
        );
    }
}
