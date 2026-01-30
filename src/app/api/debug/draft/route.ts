
import { NextResponse } from "next/server";
import { type NextRequest } from "next/server";
import prisma from "@/server/db/client";
import { env } from "@/env";
import { createEmailProvider } from "@/server/utils/email/provider";
import { createScopedLogger } from "@/server/utils/logger";
import { aiDraftReply } from "@/server/integrations/ai/reply/draft-reply";
import type { ParsedMessage, EmailForLLM } from "@/server/types";

export const maxDuration = 60; // AI might take time

function checkAuth(req: NextRequest) {
    const adminToken = req.headers.get("x-admin-token");
    const isDev = process.env.NODE_ENV === "development";
    const isAdmin = env.ADMIN_TOKEN && adminToken === env.ADMIN_TOKEN;

    if (!isDev && !isAdmin) {
        return false;
    }
    return true;
}

export async function POST(req: NextRequest) {
    if (!checkAuth(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const logger = createScopedLogger("debug/draft");

    try {
        const body = await req.json();
        const { threadId } = body;

        if (!threadId) {
            return NextResponse.json({ error: "Missing threadId" }, { status: 400 });
        }

        // 1. Find which account owns this thread
        const message = await prisma.emailMessage.findFirst({
            where: { threadId },
            select: { emailAccountId: true },
        });

        if (!message) {
            return NextResponse.json(
                { error: "Thread not found in DB" },
                { status: 404 }
            );
        }

        const { emailAccountId } = message;

        // 2. Fetch full account details (needed for AI context)
        const emailAccount = await prisma.emailAccount.findUnique({
            where: { id: emailAccountId },
            include: {
                user: {
                    include: {
                        premium: true // needed for AI access checks often
                    }
                },
                account: true, // tokens
            },
        });

        if (!emailAccount) {
            return NextResponse.json({ error: "Account not found" }, { status: 404 });
        }

        // 3. Initialize Provider to fetch full message content (content not in DB)
        // Note: We need to cast emailAccount because existing types might be stricter
        // but createEmailProvider expects minimal fields or ID.
        const provider = await createEmailProvider({
            emailAccountId,
            provider: emailAccount.account.provider,
            logger,
        });

        // 4. Fetch full thread content from Gmail
        const thread = await provider.getThread(threadId);

        // 5. Prepare context for AI
        const messagesForLLM: (EmailForLLM & { to: string })[] = thread.messages.map(
            (msg) => ({
                id: msg.id || "",
                from: msg.headers.from || "",
                to: msg.headers.to || "",
                subject: msg.headers.subject || "",
                date: new Date(msg.headers.date || Date.now()),
                text: msg.textPlain || msg.textHtml || "", // Prefer plain text
                content: msg.textPlain || msg.textHtml || "", // Added content property
            })
        );

        // 6. Generate Draft Content
        // We pass minimal context for this debug endpoint (no KB, no calendar for now)
        const replyContent = await aiDraftReply({
            messages: messagesForLLM,
            emailAccount: emailAccount as any, // bypassing strict type checks for debug
            knowledgeBaseContent: null,
            emailHistorySummary: null,
            emailHistoryContext: null,
            calendarAvailability: null,
            writingStyle: emailAccount.writingStyle,
            mcpContext: null,
            meetingContext: null,
        });

        if (typeof replyContent !== 'string') {
            return NextResponse.json({ error: "Failed to generate draft", details: replyContent }, { status: 500 });
        }

        // 7. Create Draft in Gmail
        // We pick the last message to reply to
        const lastMessage = thread.messages[thread.messages.length - 1];

        const draftResult = await provider.draftEmail(
            lastMessage,
            {
                content: replyContent,
                // draftEmail handles defaults for reply (to, subject from original)
            },
            emailAccount.email
        );

        return NextResponse.json({
            success: true,
            draftId: draftResult.draftId,
            replyContent,
        });

    } catch (error) {
        logger.error("Debug draft failed", { error });
        return NextResponse.json(
            { error: "Internal Server Error", details: String(error) },
            { status: 500 }
        );
    }
}
