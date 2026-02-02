import { NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { auth } from "@/server/auth";
import { createEmailProvider } from "@/features/email/provider";

const logger = createScopedLogger("api/drafts");

// Surfaces shared secret for authentication from external platforms
const SURFACES_SECRET = process.env.SURFACES_SHARED_SECRET;

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
        const emailAccount = await prisma.emailAccount.findFirst({
            where: { userId: session.user.id },
            include: { account: true }
        });

        if (!emailAccount) {
            return NextResponse.json({ error: "Email account not found" }, { status: 404 });
        }

        const provider = await createEmailProvider({
            emailAccountId: emailAccount.id,
            provider: emailAccount.account.provider,
            logger
        });

        const draft = await provider.getDraft(draftId);
        if (!draft) {
            return NextResponse.json({ error: "Draft not found" }, { status: 404 });
        }

        return NextResponse.json({ draft });
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
        // Find user's email account
        let emailAccount;
        
        if (emailAccountId) {
            emailAccount = await prisma.emailAccount.findFirst({
                where: { 
                    id: emailAccountId,
                    userId
                },
                include: { account: true }
            });
        } else {
            emailAccount = await prisma.emailAccount.findFirst({
                where: { userId },
                include: { account: true }
            });
        }

        if (!emailAccount) {
            return NextResponse.json({ error: "Email account not found" }, { status: 404 });
        }

        const provider = await createEmailProvider({
            emailAccountId: emailAccount.id,
            provider: emailAccount.account.provider,
            logger
        });

        // Delete the draft
        logger.info("Discarding draft", { draftId, userId, emailAccountId: emailAccount.id });
        await provider.deleteDraft(draftId);

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
