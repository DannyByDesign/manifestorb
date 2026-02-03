
import { InboundMessage, OutboundMessage } from "./types";
import { createScopedLogger } from "@/server/lib/logger";
import prisma from "@/server/db/client";
import { createGenerateText } from "@/server/lib/llms";
import { convertToCoreMessages, streamText } from "ai";
import { getModel } from "@/server/lib/llms/model";
import { createHash } from "crypto";
import { env } from "@/env";

const logger = createScopedLogger("ChannelRouter");

export class ChannelRouter {

    async handleInbound(message: InboundMessage): Promise<OutboundMessage[]> {
        logger.info("Handling inbound message", {
            provider: message.provider,
            userId: message.context.userId
        });

        // 0. Demo Bypass: Intercept "request approval" BEFORE auth check
        if (message.content.toLowerCase().includes("request approval")) {
            return [{
                targetChannelId: message.context.channelId,
                content: "I need your approval for this action.",
                interactive: {
                    type: "approval_request",
                    approvalId: "demo-request-123", // In real world this comes from ApprovalService.create
                    summary: "Demo Action: Deploy to Production",
                    actions: [
                        { label: "Approve", style: "primary", value: "approve" },
                        { label: "Deny", style: "danger", value: "deny" }
                    ]
                }
            }];
        }

        // 1. Fetch User via Account Link
        // We must look up the user by their external provider ID (Account table)
        // rather than assuming message.context.userId is already a UUID.

        const account = await prisma.account.findUnique({
            where: {
                provider_providerAccountId: {
                    provider: message.provider,
                    providerAccountId: message.context.userId
                }
            },
            include: {
                user: {
                    include: {
                        emailAccounts: {
                            take: 1, // Naive context: grab first email account
                            include: {
                                account: true
                            }
                        }
                    }
                }
            }
        });

        if (!account || !account.user) {
            const { createLinkToken } = await import("@/server/lib/linking");
            const { env } = await import("@/env");

            const token = await createLinkToken({
                provider: message.provider,
                providerAccountId: message.context.userId,
                providerTeamId: (message.context as any).teamId, // If available
                metadata: {
                    channelId: message.context.channelId
                }
            });

            const linkUrl = `${env.NEXT_PUBLIC_BASE_URL}/link?token=${token}`;

            return [{
                targetChannelId: message.context.channelId,
                content: `Welcome! I don't recognize this ${message.provider} account yet.\n\nPlease [Link Your Account](${linkUrl}) to enable AI features.`,
                interactive: {
                    type: "approval_request", // Reusing this type for now to show a button if possible, but the link is primary
                    approvalId: "link-account",
                    summary: "Link Account",
                    actions: [
                        { label: "Link Account", style: "primary", value: linkUrl, url: linkUrl }
                    ]
                }
            }];
        }

        const user = account.user;
        const emailAccount = user.emailAccounts[0];

        if (!emailAccount) {
            return [{
                targetChannelId: message.context.channelId,
                content: "Your account is linked, but you haven't connected a Gmail/Outlook account yet.\n\nPlease go to the Amodel Web App to connect your email."
            }];
        }

        const threadId = (message.context as any).threadId || null;
        const channelId = message.context.channelId;
        const providerMessageId = (message.context as any).messageId;

        // 1.5 Ensure Stable Conversation
        // We find or create the conversation based on the external context.
        // Prisma's "connectOrCreate" or upsert is good here if we have a unique constraint.
        // schema: @@unique([userId, provider, channelId, threadId]) - Note: Postgres unique with NULLs works (distinct), 
        // BUT strict equality on NULL varies. Prisma handles this well typically? 
        // Actually, for safety, if threadId is missing, we must be careful.
        // To avoid complex nullable unique issues, we can check first.

        let conversation = await prisma.conversation.findFirst({
            where: {
                userId: user.id,
                provider: message.provider,
                channelId: channelId,
                threadId: threadId // Prisma treats undefined/null as NULL match
            }
        });

        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    userId: user.id,
                    provider: message.provider,
                    channelId: channelId,
                    threadId: threadId,
                }
            });
        }

        // 1.6 Persist Inbound Message (Unified History) with Dedupe
        // Dedupe Key: SHA-256(provider : channelId : messageId)
        // Fallback for web/transient: content hash
        let dedupeKey = "";
        if (providerMessageId) {
            dedupeKey = createHash("sha256")
                .update(`${message.provider}:${channelId}:${providerMessageId}`)
                .digest("hex");
        } else {
            dedupeKey = createHash("sha256")
                .update(`${message.provider}:${channelId}:${message.content}:${Date.now()}`) // Transient fallback
                .digest("hex");
        }

        try {
            const { PrivacyService } = await import("@/features/privacy/service");
            const shouldRecord = await PrivacyService.shouldRecord(user.id);

            if (shouldRecord) {
                await prisma.conversationMessage.upsert({
                    where: {
                        dedupeKey: dedupeKey
                    },
                    update: {}, // Idempotent
                    create: {
                        // id: default cuid is fine
                        userId: user.id,
                        conversationId: conversation.id, // Linked!
                        dedupeKey: dedupeKey,
                        role: "user",
                        content: message.content,
                        toolCalls: undefined, // Fix null error: InputJsonValue | undefined

                        provider: message.provider,
                        providerMessageId: providerMessageId,
                        channelId: channelId,
                        threadId: threadId,

                        emailAccountId: emailAccount.id
                    }
                });
            }
        } catch (err) {
            logger.error("Failed to persist inbound message", { error: err });
        }

        // 3. Trigger Memory Recording (Async)
        // UNIFIED: Uses userId for cross-platform memory
        try {
            const { MemoryRecordingService } = await import("@/features/memory/service");
            if (await MemoryRecordingService.shouldRecord(user.id)) {
                await MemoryRecordingService.enqueueMemoryRecording(user.id, emailAccount.email);
            }
        } catch (e) {
            logger.error("Failed to trigger memory recording", { error: e });
        }

        // 2. Run Unified Agent
        try {
            const { runOneShotAgent } = await import("@/features/channels/executor");

            const { text, approvals, interactivePayloads } = await runOneShotAgent({
                user: user,
                emailAccount: emailAccount,
                message: message.content,
                context: {
                    conversationId: conversation.id, // Include this!
                    channelId: message.context.channelId,
                    provider: message.provider,
                    userId: message.context.userId,
                    teamId: (message.context as any).teamId,
                    messageId: dedupeKey, // Use our internal key or the provider id? Executor expects messageId for thread?
                    // Actually executor context is type { ... messageId? ... }. 
                    // Let's pass the real providerMessageId for reference, but usage in executor should change.
                    threadId: (message.context as any).threadId || undefined
                }
            });

            // 3. Construct Output
            const outbound: OutboundMessage = {
                targetChannelId: message.context.channelId,
                content: text
            };

            // Priority 1: Attach interactive payload from tool results (e.g., draft buttons)
            if (interactivePayloads && interactivePayloads.length > 0) {
                outbound.interactive = interactivePayloads[0]; // Use first interactive payload
            }
            // Priority 2: Attach interactive approval UI if generated
            else if (approvals && approvals.length > 0) {
                const approval = approvals[0]; // Just show the first one for simplicity
                const { env } = await import("@/env");

                outbound.interactive = {
                    type: "approval_request",
                    approvalId: approval.id,
                    summary: "Approval Requested",
                    actions: [
                        { label: "Approve", style: "primary", value: "approve", url: `${env.NEXT_PUBLIC_BASE_URL}/approvals/${approval.id}` },
                        { label: "Deny", style: "danger", value: "deny" }
                    ]
                };
            }

            return [outbound];

        } catch (error) {
            logger.error("Error running agent", { error });
            return [{
                targetChannelId: message.context.channelId,
                content: "I encountered an error processing your request."
            }];
        }
    }

    /**
     * Pushes a message to the user's active channel (Slack/Discord).
     * Uses the most recent conversation to determine where to send.
     */
    async pushMessage(userId: string, content: string): Promise<boolean> {
        try {
            // Find the most recent conversation on a supported platform
            const conversation = await prisma.conversation.findFirst({
                where: {
                    userId: userId,
                    provider: { in: ["slack", "discord"] }
                },
                orderBy: { updatedAt: "desc" }
            });

            if (!conversation) {
                logger.warn("No active conversation found for push", { userId });
                return false;
            }

            const surfaceUrl = env.SURFACES_API_URL || "http://localhost:3001";

            const response = await fetch(`${surfaceUrl}/notify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    platform: conversation.provider,
                    channelId: conversation.channelId,
                    content: content
                })
            });

            if (!response.ok) {
                logger.error("Failed to push message to surface", {
                    status: response.status,
                    userId,
                    provider: conversation.provider
                });
                return false;
            }

            return true;

        } catch (error) {
            logger.error("Error in pushMessage", { error, userId });
            return false;
        }
    }
}
