import { NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { auth } from "@/server/auth";
import { createEmailProvider } from "@/features/email/provider";

const logger = createScopedLogger("api/drafts/send");

// Surfaces shared secret for authentication from external platforms
const SURFACES_SECRET = process.env.SURFACES_SHARED_SECRET;

/**
 * POST /api/drafts/:id/send
 * 
 * Sends a draft email. This is the ONLY way to send emails - AI cannot call this directly.
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
        // Find user's email account
        let emailAccount;
        
        if (emailAccountId) {
            emailAccount = await prisma.emailAccount.findFirst({
                where: { 
                    id: emailAccountId,
                    userId // Ensure user owns this account
                },
                include: { account: true }
            });
        } else {
            // Find primary email account for user
            emailAccount = await prisma.emailAccount.findFirst({
                where: { userId },
                include: { account: true }
            });
        }

        if (!emailAccount) {
            return NextResponse.json({ error: "Email account not found" }, { status: 404 });
        }

        // Create email provider
        const provider = await createEmailProvider({
            emailAccountId: emailAccount.id,
            provider: emailAccount.account.provider,
            logger
        });

        // Verify draft exists and belongs to user (optional - sendDraft will fail if not found)
        const draft = await provider.getDraft(draftId);
        if (!draft) {
            return NextResponse.json({ error: "Draft not found" }, { status: 404 });
        }

        // Send the draft
        logger.info("Sending draft", { draftId, userId, emailAccountId: emailAccount.id });
        const result = await provider.sendDraft(draftId);

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
        logger.error("Failed to send draft", { error: err, draftId, userId });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to send draft" },
            { status: 500 }
        );
    }
}
