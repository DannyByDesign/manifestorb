
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import prisma from "@/server/db/client";
import { ConversationService } from "@/server/conversations/service";
import { PrivacyService } from "@/server/privacy/service";
import { runOneShotAgent } from "@/server/agent/executor";

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    const { message, clientMessageId } = await req.json();

    if (!message) {
        return new NextResponse("Message required", { status: 400 });
    }

    // 1. Get Primary Conversation
    const conversation = await ConversationService.getPrimaryWebConversation(session.user.id);

    // 2. Check Privacy
    const shouldRecord = await PrivacyService.shouldRecord(session.user.id);

    // 3. Dedupe Key for User Message
    const role = "user";
    const dedupeKey = ConversationService.computeDedupeKey({
        provider: "web",
        role,
        contentHash: clientMessageId || message, // Use client ID if available
        userId: session.user.id,
        channelId: null,
        threadId: null
    });

    // 4. Persist User Message (if allowed)
    if (shouldRecord) {
        try {
            await prisma.conversationMessage.upsert({
                where: { dedupeKey },
                update: {}, // Idempotent
                create: {
                    userId: session.user.id,
                    conversationId: conversation.id,
                    role,
                    content: message,
                    provider: "web",
                    dedupeKey,
                    // Web has no channel/thread
                    channelId: null,
                    threadId: null,
                    providerMessageId: clientMessageId || null
                }
            });
        } catch (e) {
            console.error("Failed to persist user message", e);
        }
    }

    // 5. Run Agent
    // We need the full user object and email account for the agent.
    // Assuming session has user.id, we fetch the User and EmailAccount.
    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        include: { emailAccounts: true } // Helper to get an email account
    });

    if (!user) return new NextResponse("User not found", { status: 404 });

    // Pick primary email account (fallback logic)
    const emailAccount = user.emailAccounts[0];
    if (!emailAccount) return new NextResponse("No email account linked", { status: 400 });

    const result = await runOneShotAgent({
        user,
        emailAccount,
        message,
        context: {
            conversationId: conversation.id,
            channelId: "web",
            provider: "web",
            userId: user.id,
            messageId: dedupeKey // Used for deduping assistant path
        }
    });

    // Assistant persistence is handled inside runOneShotAgent, respecting PrivacyService.

    // 6. Trigger Summarization (Fire & Forget)
    (async () => {
        try {
            const { SummaryService } = await import("@/server/summaries/service");
            if (await SummaryService.shouldSummarize(conversation.id)) {
                await SummaryService.enqueueSummarizeConversation(conversation.id);
            }
        } catch (e) {
            console.error("Summary trigger failed", e);
        }
    })();

    return NextResponse.json({
        role: "assistant",
        content: result.text,
        approvals: result.approvals
    });
}
