import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import prisma from "@/server/db/client";
import { ConversationService } from "@/features/conversations/service";
import { PrivacyService } from "@/features/privacy/service";
import { runOneShotAgent } from "@/features/channels/executor";
import { z } from "zod";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("api/chat");

// Zod schema for chat request validation
const chatBodySchema = z.object({
    message: z.string().min(1).max(50000), // Reasonable max length
    clientMessageId: z.string().optional(),
});

export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const body = await req.json();
        
        // Validate request body with Zod
        const parseResult = chatBodySchema.safeParse(body);
        if (!parseResult.success) {
            logger.warn("Invalid request body", { errors: parseResult.error.issues });
            return NextResponse.json(
                { error: "Invalid request body", details: parseResult.error.issues },
                { status: 400 }
            );
        }
        
        const { message, clientMessageId } = parseResult.data;

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
                logger.error("Failed to persist user message", { error: e });
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

        // 6. Trigger Memory Recording (Fire & Forget)
        // UNIFIED: Uses userId for cross-platform memory
        (async () => {
            try {
                const { MemoryRecordingService } = await import("@/features/memory/service");
                if (await MemoryRecordingService.shouldRecord(user.id)) {
                    await MemoryRecordingService.enqueueMemoryRecording(user.id, emailAccount.email);
                }
            } catch (e) {
                logger.error("Memory recording trigger failed", { error: e });
            }
        })();

        return NextResponse.json({
            role: "assistant",
            content: result.text,
            approvals: result.approvals
        });
    } catch (err) {
        logger.error("Error in chat", { error: err });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
