
import { InboundMessage, OutboundMessage, type InteractivePayload } from "./types";
import { createScopedLogger } from "@/server/lib/logger";
import prisma from "@/server/db/client";
import { createGenerateText } from "@/server/lib/llms";
import { convertToCoreMessages, streamText } from "ai";
import { getModel } from "@/server/lib/llms/model";
import { createHash } from "crypto";
import { env } from "@/env";
import { createApprovalActionToken } from "@/features/approvals/action-token";
import { getErrorMessage } from "@/server/lib/error";

const logger = createScopedLogger("ChannelRouter");

function buildTimeRangeFromChanges(changes?: Record<string, any>): string | undefined {
    if (!changes) return undefined;
    const start = changes.start || changes.scheduledStart || changes.startDate;
    const end = changes.end || changes.scheduledEnd;
    const due = changes.dueDate;

    if (start && end) {
        return `${start} → ${end}`;
    }
    if (start) {
        return `starting ${start}`;
    }
    if (due) {
        return `due ${due}`;
    }
    return undefined;
}

function buildApprovalInteractivePayload(params: {
    approval: any;
    baseUrl: string;
}): InteractivePayload {
    const { approval, baseUrl } = params;
    const payload = approval?.requestPayload as Record<string, any> | undefined;
    const toolName = payload?.tool;
    const args = payload?.args || {};
    const resource = args?.resource;
    const changes = args?.changes || {};

    let approveUrl = `${baseUrl}/approvals/${approval.id}`;
    let denyUrl = `${baseUrl}/approvals/${approval.id}/deny`;
    try {
        const approveToken = createApprovalActionToken({
            approvalId: approval.id,
            action: "approve"
        });
        const denyToken = createApprovalActionToken({
            approvalId: approval.id,
            action: "deny"
        });
        approveUrl = `${approveUrl}?token=${approveToken}`;
        denyUrl = `${denyUrl}?token=${denyToken}`;
    } catch (error) {
        logger.warn("Failed to create approval action tokens", { error });
    }

    const approvalActions = [
        { label: "Approve", style: "primary" as const, value: "approve", url: approveUrl },
        { label: "Deny", style: "danger" as const, value: "deny", url: denyUrl },
    ];

    if (
        payload?.actionType === "tool_execution" &&
        (toolName === "modify" || toolName === "delete") &&
        (resource === "calendar" || resource === "task")
    ) {
        const action = toolName === "delete" ? "delete" : "modify";
        const title = changes.title || changes.subject || changes.name || changes.summary;
        const timeRange = buildTimeRangeFromChanges(changes);
        const itemLabel = resource === "calendar" ? "calendar event" : "task";
        const subject = title ? `“${title}”` : `this ${itemLabel}`;
        const verb = action === "delete" ? "delete" : "update";
        const summary = `Want me to ${verb} ${subject}${timeRange ? ` (${timeRange})` : ""}?`;

        return {
            type: "action_request",
            approvalId: approval.id,
            summary,
            actions: approvalActions,
            context: {
                resource,
                action,
                title,
                timeRange
            }
        };
    }

    return {
        type: "approval_request",
        approvalId: approval.id,
        summary: "Want me to proceed with that?",
        actions: approvalActions
    };
}

export class ChannelRouter {

    async handleInbound(message: InboundMessage): Promise<OutboundMessage[]> {
        logger.info("Handling inbound message", {
            provider: message.provider,
            userId: message.context.userId
        });

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
            logger.warn("No linked surface account found", {
                provider: message.provider,
                providerAccountId: message.context.userId,
                channelId: message.context.channelId,
                workspaceId: message.context.workspaceId ?? null,
                threadId: message.context.threadId ?? null,
            });
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
        logger.info("Resolved linked surface account", {
            provider: message.provider,
            providerAccountId: message.context.userId,
            resolvedUserId: user.id,
            emailAccountsCount: user.emailAccounts.length,
            channelId: message.context.channelId,
            threadId: message.context.threadId ?? null,
        });
        const { resolveEmailAccount } = await import("@/server/lib/user-utils");
        const emailAccount = resolveEmailAccount(user, null);

        if (!emailAccount) {
            logger.warn("Linked user has no email account", {
                resolvedUserId: user.id,
                provider: message.provider,
                channelId: message.context.channelId,
            });
            return [{
                targetChannelId: message.context.channelId,
                content: "Your account is linked, but you haven't connected a Gmail/Outlook account yet.\n\nPlease go to the Amodel Web App to connect your email."
            }];
        }

        if (emailAccount.account?.disconnectedAt) {
            logger.warn("Linked email account is disconnected", {
                resolvedUserId: user.id,
                emailAccountId: emailAccount.id,
                provider: message.provider,
                channelId: message.context.channelId,
                disconnectedAt: emailAccount.account.disconnectedAt,
            });
            return [{
                targetChannelId: message.context.channelId,
                content: `Your email account (${emailAccount.email}) has been disconnected (e.g. due to a password change or revoked access).\n\nPlease reconnect it in the Amodel web app: ${env.NEXT_PUBLIC_BASE_URL}/connect`,
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
            logger.info("Created new conversation for inbound message", {
                conversationId: conversation.id,
                resolvedUserId: user.id,
                provider: message.provider,
                channelId,
                threadId,
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
                    messageId: providerMessageId ?? dedupeKey,
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

                outbound.interactive = buildApprovalInteractivePayload({
                    approval,
                    baseUrl: env.NEXT_PUBLIC_BASE_URL
                });
            }

            logger.info("Built outbound response", {
                conversationId: conversation.id,
                resolvedUserId: user.id,
                provider: message.provider,
                channelId: message.context.channelId,
                contentLength: outbound.content.length,
                hasInteractive: Boolean(outbound.interactive),
                approvalsCount: approvals?.length ?? 0,
                interactivePayloadsCount: interactivePayloads?.length ?? 0,
            });

            return [outbound];

        } catch (error) {
            logger.error("Error running agent", { error });
            const baseContent = "I encountered an error processing your request.";
            const verbose =
                env.NODE_ENV !== "production" ||
                process.env.E2E_VERBOSE_ERRORS === "true";
            const detail = verbose
                ? (getErrorMessage(error) ?? (error instanceof Error ? error.message : String(error)))
                : "";
            const content = detail
                ? `${baseContent} ${detail}`
                : baseContent;
            return [{
                targetChannelId: message.context.channelId,
                content,
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
                    provider: { in: ["slack", "discord", "telegram"] }
                },
                orderBy: { updatedAt: "desc" }
            });

            if (!conversation) {
                logger.warn("No active conversation found for push", { userId });
                return false;
            }

            const surfaceUrl = env.SURFACES_API_URL || "http://localhost:3001";
            const surfacesSecret = env.SURFACES_SHARED_SECRET;

            if (!surfacesSecret) {
                logger.warn("SURFACES_SHARED_SECRET not set; skipping notify", { userId });
                return false;
            }

            const response = await fetch(`${surfaceUrl}/notify`, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${surfacesSecret}`
                },
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
