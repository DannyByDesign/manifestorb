import { NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { auth } from "@/server/auth";
import { createEmailProvider } from "@/features/email/provider";

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
        // Find user's email account(s)
        let emailAccount;
        
        if (emailAccountId) {
            emailAccount = await prisma.emailAccount.findFirst({
                where: { 
                    id: emailAccountId,
                    userId: session.user.id
                },
                include: { account: true }
            });
        } else {
            // Default to first email account
            emailAccount = await prisma.emailAccount.findFirst({
                where: { userId: session.user.id },
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

        // Fetch drafts from provider
        const drafts = await provider.getDrafts({ maxResults });

        // Transform to a consistent response format
        const formattedDrafts = drafts.map(draft => ({
            id: draft.id,
            threadId: draft.threadId,
            subject: draft.headers?.subject || "(no subject)",
            to: draft.headers?.to || "",
            from: draft.headers?.from || emailAccount.email,
            date: draft.headers?.date || new Date().toISOString(),
            snippet: draft.snippet || draft.textPlain?.slice(0, 200) || "",
            // Include full body for preview
            body: draft.textHtml || draft.textPlain || ""
        }));

        return NextResponse.json({
            drafts: formattedDrafts,
            emailAccountId: emailAccount.id,
            count: formattedDrafts.length
        });

    } catch (err) {
        logger.error("Failed to list drafts", { error: err, userId: session.user.id });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to list drafts" },
            { status: 500 }
        );
    }
}
