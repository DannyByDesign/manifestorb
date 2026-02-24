
import {
    InboundMessage,
    OutboundMessage,
    type ChannelProvider,
    type InteractivePayload,
} from "./types";
import { createScopedLogger } from "@/server/lib/logger";
import prisma from "@/server/db/client";
import { createHash } from "crypto";
import { env } from "@/env";
import { createApprovalActionToken } from "@/features/approvals/action-token";
import { getErrorMessage } from "@/server/lib/error";
import { internalIssueMessage } from "@/features/ai/conversational-copy";
import {
    buildConversationIdentityKey,
    deriveCanonicalThreadId,
    outboundThreadIdForProvider,
} from "./conversation-key";
import { runSerializedConversationTurn } from "./runtime";
import { enqueueConversationMessageEmbedding } from "@/features/memory/embeddings/conversation-ingestion";
import {
    preferredProviderAccountId,
    resolveSurfaceAccount,
} from "./surface-account";
import { createDeterministicIdempotencyKey } from "@/server/lib/idempotency";
import { getSurfacesBaseUrl } from "@/server/lib/surfaces-url";

const logger = createScopedLogger("ChannelRouter");
const ACCOUNT_ACTION_KEYWORDS = [
    "inbox",
    "email",
    "mail",
    "gmail",
    "calendar",
    "event",
    "meeting",
    "schedule",
    "draft",
    "send",
    "reply",
    "forward",
    "archive",
    "trash",
    "unread",
    "search",
];

function requiresAccountDisambiguationForMessage(content: string): boolean {
    const normalized = content.toLowerCase();
    return ACCOUNT_ACTION_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function formatAccountChoicePrompt(emails: string[]): string {
    const options = emails.map((email) => `- ${email}`).join("\n");
    return [
        "I found multiple connected accounts. Please tell me which account to use before I read or change inbox/calendar data.",
        "",
        "Available accounts:",
        options,
        "",
        "Reply with the account email (for example: \"use work@example.com\").",
    ].join("\n");
}

async function resolveCanonicalConversation(params: {
    userId: string;
    provider: ChannelProvider;
    channelId: string;
    threadId: string;
}) {
    const where = {
        userId: params.userId,
        provider: params.provider,
        channelId: params.channelId,
        threadId: params.threadId,
    };

    const existing = await prisma.conversation.findFirst({ where });
    if (existing) return existing;

    const legacyWithoutThread = await prisma.conversation.findFirst({
        where: {
            userId: params.userId,
            provider: params.provider,
            channelId: params.channelId,
            threadId: null,
        },
        orderBy: { updatedAt: "desc" },
    });

    if (legacyWithoutThread) {
        try {
            return await prisma.conversation.update({
                where: { id: legacyWithoutThread.id },
                data: { threadId: params.threadId },
            });
        } catch (error) {
            const maybeCode =
                typeof error === "object" && error !== null && "code" in error
                    ? (error as { code?: unknown }).code
                    : undefined;
            if (maybeCode !== "P2002") throw error;
            const conflicted = await prisma.conversation.findFirst({ where });
            if (conflicted) return conflicted;
            throw error;
        }
    }

    try {
        return await prisma.conversation.create({
            data: {
                userId: params.userId,
                provider: params.provider,
                channelId: params.channelId,
                threadId: params.threadId,
            },
        });
    } catch (error) {
        const maybeCode =
            typeof error === "object" && error !== null && "code" in error
                ? (error as { code?: unknown }).code
                : undefined;
        if (maybeCode !== "P2002") throw error;
        const conflicted = await prisma.conversation.findFirst({ where });
        if (conflicted) return conflicted;
        throw error;
    }
}

function buildTimeRangeFromChanges(changes?: Record<string, unknown>): string | undefined {
    if (!changes) return undefined;
    const start =
        (typeof changes.start === "string" && changes.start) ||
        (typeof changes.scheduledStart === "string" && changes.scheduledStart) ||
        (typeof changes.startDate === "string" && changes.startDate);
    const end =
        (typeof changes.end === "string" && changes.end) ||
        (typeof changes.scheduledEnd === "string" && changes.scheduledEnd);
    const due = typeof changes.dueDate === "string" ? changes.dueDate : undefined;

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
    approval: {
        id: string;
        requestPayload?: unknown;
    };
    baseUrl: string;
}): InteractivePayload {
    const { approval, baseUrl } = params;
    const payload =
        approval?.requestPayload && typeof approval.requestPayload === "object"
            ? (approval.requestPayload as Record<string, unknown>)
            : undefined;
    const toolName = payload?.tool;
    const args =
        payload?.args && typeof payload.args === "object"
            ? (payload.args as Record<string, unknown>)
            : {};
    const resource = args.resource;
    const changes =
        args.changes && typeof args.changes === "object"
            ? (args.changes as Record<string, unknown>)
            : {};

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
        (payload?.actionType === "tool_execute" || payload?.actionType === "tool_execution") &&
        (toolName === "modify" || toolName === "delete") &&
        (resource === "calendar" || resource === "task")
    ) {
        const action = toolName === "delete" ? "delete" : "modify";
        const rawTitle = changes.title || changes.subject || changes.name || changes.summary;
        const title = typeof rawTitle === "string" ? rawTitle : undefined;
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

async function findLinkedSurfaceAccount(params: {
    provider: ChannelProvider;
    providerAccountId: string;
    workspaceId?: string;
}) {
    const include = {
        user: {
            include: {
                emailAccounts: {
                    orderBy: {
                        updatedAt: "desc" as const,
                    },
                    include: {
                        account: true,
                    },
                },
            },
        },
    };

    const resolved = await resolveSurfaceAccount(params);
    if (!resolved.userId || !resolved.matchedProviderAccountId) {
        if (resolved.resolutionStatus === "unknown") {
            logger.warn("Ambiguous Slack account lookup by suffix", {
                providerAccountId: params.providerAccountId,
                workspaceId: params.workspaceId ?? null,
                matches: resolved.ambiguousMatches ?? [],
            });
        }
        return {
            account: null,
            matchedProviderAccountId: resolved.matchedProviderAccountId,
            resolutionStatus: resolved.resolutionStatus,
        };
    }

    const account = await prisma.account.findUnique({
        where: {
            provider_providerAccountId: {
                provider: params.provider,
                providerAccountId: resolved.matchedProviderAccountId,
            },
        },
        include,
    });
    if (account?.user) {
        return {
            account,
            matchedProviderAccountId: resolved.matchedProviderAccountId,
            resolutionStatus: "linked" as const,
        };
    }

    return {
        account: null,
        matchedProviderAccountId: resolved.matchedProviderAccountId,
        resolutionStatus: "unlinked" as const,
    };
}

export class ChannelRouter {

    async handleInbound(message: InboundMessage): Promise<OutboundMessage[]> {
        logger.info("Handling inbound message", {
            provider: message.provider,
            userId: message.context.userId
        });

        const channelId = message.context.channelId;
        const incomingThreadId =
            (message.context as { threadId?: string }).threadId ?? null;
        const isDirectMessage = message.context.isDirectMessage === true;
        const providerMessageId =
            (message.context as { messageId?: string }).messageId;
        const canonicalThreadId = deriveCanonicalThreadId({
            provider: message.provider,
            isDirectMessage,
            incomingThreadId,
            messageId: providerMessageId,
        });
        const renderResponses = async (responses: OutboundMessage[]): Promise<OutboundMessage[]> =>
            responses;

        // 1. Fetch User via Account Link
        // We must look up the user by their external provider ID (Account table)
        // rather than assuming message.context.userId is already a UUID.
        const linkedAccount = await findLinkedSurfaceAccount({
            provider: message.provider,
            providerAccountId: message.context.userId,
            workspaceId:
                typeof message.context.workspaceId === "string"
                    ? message.context.workspaceId
                    : undefined,
        });

        if (!linkedAccount.account || !linkedAccount.account.user) {
            logger.warn("No linked surface account found", {
                provider: message.provider,
                providerAccountId: message.context.userId,
                preferredProviderAccountId: preferredProviderAccountId({
                    provider: message.provider,
                    providerAccountId: message.context.userId,
                    workspaceId:
                        typeof message.context.workspaceId === "string"
                            ? message.context.workspaceId
                            : undefined,
                }),
                resolutionStatus: linkedAccount.resolutionStatus,
                channelId: message.context.channelId,
                workspaceId: message.context.workspaceId ?? null,
                threadId: message.context.threadId ?? null,
            });
            const { createLinkToken } = await import("@/server/lib/linking");
            const { env } = await import("@/env");

            const resolvedProviderAccountId = preferredProviderAccountId({
                provider: message.provider,
                providerAccountId: message.context.userId,
                workspaceId:
                    typeof message.context.workspaceId === "string"
                        ? message.context.workspaceId
                        : undefined,
            });
            const token = await createLinkToken({
                provider: message.provider,
                providerAccountId: resolvedProviderAccountId,
                providerTeamId:
                    typeof message.context.workspaceId === "string" && message.context.workspaceId.length > 0
                        ? message.context.workspaceId
                        : undefined,
                metadata: {
                    channelId: message.context.channelId
                }
            });

            const linkUrl = `${env.NEXT_PUBLIC_BASE_URL}/link?token=${token}`;

            return await renderResponses([{
                targetChannelId: message.context.channelId,
                targetThreadId: outboundThreadIdForProvider({
                    provider: message.provider,
                    isDirectMessage,
                    canonicalThreadId,
                }),
                content: `Welcome! I don't recognize this ${message.provider} account yet.\n\nPlease [Link Your Account](${linkUrl}) to enable AI features.`,
                interactive: {
                    type: "approval_request", // Reusing this type for now to show a button if possible, but the link is primary
                    approvalId: "link-account",
                    summary: "Link Account",
                    actions: [
                        { label: "Link Account", style: "primary", value: linkUrl, url: linkUrl }
                    ]
                }
            }]);
        }

        const user = linkedAccount.account.user;
        logger.info("Resolved linked surface account", {
            provider: message.provider,
            providerAccountId: linkedAccount.matchedProviderAccountId ?? message.context.userId,
            resolvedUserId: user.id,
            emailAccountsCount: user.emailAccounts.length,
            channelId: message.context.channelId,
            threadId: message.context.threadId ?? null,
        });
        const canonicalConversation = await resolveCanonicalConversation({
            userId: user.id,
            provider: message.provider,
            channelId,
            threadId: canonicalThreadId,
        });
        const lastConversationAccount = await prisma.conversationMessage.findFirst({
            where: {
                conversationId: canonicalConversation.id,
                emailAccountId: { not: null },
            },
            orderBy: { createdAt: "desc" },
            select: { emailAccountId: true },
        });
        const {
            resolveEmailAccount,
            resolveEmailAccountFromMessageHint,
        } = await import("@/server/lib/user-utils");
        const hintedEmailAccount = resolveEmailAccountFromMessageHint(
            user,
            message.content,
        );
        const preferredEmailAccountId =
            hintedEmailAccount?.id ??
            lastConversationAccount?.emailAccountId ??
            null;
        let emailAccount = resolveEmailAccount(
            user,
            preferredEmailAccountId,
            { allowImplicit: false },
        );

        if (
            !emailAccount &&
            user.emailAccounts.length > 1 &&
            requiresAccountDisambiguationForMessage(message.content)
        ) {
            return await renderResponses([{
                targetChannelId: message.context.channelId,
                targetThreadId: outboundThreadIdForProvider({
                    provider: message.provider,
                    isDirectMessage,
                    canonicalThreadId,
                }),
                content: formatAccountChoicePrompt(
                    user.emailAccounts.map((account) => account.email),
                ),
            }]);
        }

        emailAccount = emailAccount ?? resolveEmailAccount(
            user,
            preferredEmailAccountId,
            { allowImplicit: true },
        );

        if (!emailAccount) {
            logger.warn("Linked user has no email account", {
                resolvedUserId: user.id,
                provider: message.provider,
                channelId: message.context.channelId,
            });
            return await renderResponses([{
                targetChannelId: message.context.channelId,
                targetThreadId: outboundThreadIdForProvider({
                    provider: message.provider,
                    isDirectMessage,
                    canonicalThreadId,
                }),
                content: "Your account is linked, but you haven't connected a Gmail account yet.\n\nPlease go to the Amodel Web App to connect your email.",
            }]);
        }

        const accountRowForEmailAccount = user.emailAccounts.find(
            (candidate) => candidate.id === emailAccount.id,
        );
        if (accountRowForEmailAccount?.account?.disconnectedAt) {
            logger.warn("Linked email account is disconnected", {
                resolvedUserId: user.id,
                emailAccountId: emailAccount.id,
                provider: message.provider,
                channelId: message.context.channelId,
                disconnectedAt: accountRowForEmailAccount.account.disconnectedAt,
            });
            return await renderResponses([{
                targetChannelId: message.context.channelId,
                targetThreadId: outboundThreadIdForProvider({
                    provider: message.provider,
                    isDirectMessage,
                    canonicalThreadId,
                }),
                content: `Your email account (${emailAccount.email}) has been disconnected (e.g. due to a password change or revoked access).\n\nPlease reconnect it in the Amodel web app: ${env.NEXT_PUBLIC_BASE_URL}/connect`,
            }]);
        }

        const queueKey = buildConversationIdentityKey({
            userId: user.id,
                provider: message.provider,
                channelId,
                threadId: canonicalThreadId,
        });

        try {
            const responses = await runSerializedConversationTurn({
                queueKey,
                provider: message.provider,
                channelId,
                threadId: canonicalThreadId,
                execute: async () => {
                    const conversation = canonicalConversation;
                    const conversationThreadId =
                        conversation.threadId ?? canonicalThreadId;

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
                            .update(`${message.provider}:${channelId}:${message.content}:${Date.now()}`)
                            .digest("hex");
                    }

                    try {
                        const { PrivacyService } = await import("@/features/privacy/service");
                        const shouldRecord = await PrivacyService.shouldRecord(user.id);

                        if (shouldRecord) {
                            const persisted = await prisma.conversationMessage.upsert({
                                where: {
                                    dedupeKey: dedupeKey,
                                },
                                update: {},
                                create: {
                                    userId: user.id,
                                    conversationId: conversation.id,
                                    dedupeKey: dedupeKey,
                                    role: "user",
                                    content: message.content,
                                    toolCalls: undefined,
                                    provider: message.provider,
                                    providerMessageId: providerMessageId,
                                    channelId: channelId,
                                    threadId: conversationThreadId,
                                    emailAccountId: emailAccount.id,
                                },
                            });

                            enqueueConversationMessageEmbedding({
                                recordId: persisted.id,
                                content: message.content,
                                role: "user",
                                email: emailAccount.email,
                                logger,
                            }).catch((error) => {
                                logger.warn("Failed to enqueue inbound conversation embedding", { error });
                            });
                        }
                    } catch (err) {
                        logger.error("Failed to persist inbound message", { error: err });
                    }

                    try {
                        const { MemoryRecordingService } = await import("@/features/memory/service");
                        if (await MemoryRecordingService.shouldRecord(user.id)) {
                            await MemoryRecordingService.enqueueMemoryRecording(
                                user.id,
                                emailAccount.email,
                            );
                        }
                    } catch (e) {
                        logger.error("Failed to trigger memory recording", { error: e });
                    }

                    try {
                        const { runOneShotAgent } = await import("@/features/channels/executor");

                        const { text, approvals, interactivePayloads } = await runOneShotAgent({
                            user: user,
                            emailAccount: emailAccount,
                            message: message.content,
                            history: message.history,
                            context: {
                                conversationId: conversation.id,
                                channelId: message.context.channelId,
                                provider: message.provider,
                                userId: message.context.userId,
                                teamId:
                                    "teamId" in message.context &&
                                    typeof message.context.teamId === "string"
                                        ? message.context.teamId
                                        : undefined,
                                messageId: providerMessageId ?? dedupeKey,
                                threadId: conversationThreadId,
                            },
                        });

                        const outboundThreadId = outboundThreadIdForProvider({
                            provider: message.provider,
                            isDirectMessage,
                            canonicalThreadId: conversationThreadId,
                        });
                        const outbound: OutboundMessage = {
                            targetChannelId: message.context.channelId,
                            targetThreadId: outboundThreadId,
                            content: text,
                        };

                        if (interactivePayloads && interactivePayloads.length > 0) {
                            outbound.interactive = interactivePayloads[0];
                        } else if (approvals && approvals.length > 0) {
                            const approval = approvals[0];
                            const { env } = await import("@/env");

                            outbound.interactive = buildApprovalInteractivePayload({
                                approval,
                                baseUrl: env.NEXT_PUBLIC_BASE_URL,
                            });
                        }

                        logger.info("Built outbound response", {
                            conversationId: conversation.id,
                            resolvedUserId: user.id,
                            provider: message.provider,
                            channelId: message.context.channelId,
                            threadId: outboundThreadId ?? null,
                            contentLength: outbound.content.length,
                            hasInteractive: Boolean(outbound.interactive),
                            approvalsCount: approvals?.length ?? 0,
                            interactivePayloadsCount: interactivePayloads?.length ?? 0,
                        });

                        return [outbound];
                    } catch (error) {
                        logger.error("Error running agent", { error });
                        const baseContent = internalIssueMessage();
                        const verbose =
                            env.NODE_ENV !== "production" ||
                            process.env.E2E_VERBOSE_ERRORS === "true";
                        const detail = verbose
                            ? (getErrorMessage(error) ??
                                (error instanceof Error ? error.message : String(error)))
                            : "";
                        const content = detail
                            ? `${baseContent} Details: ${detail}`
                            : baseContent;
                        return [
                            {
                                targetChannelId: message.context.channelId,
                                targetThreadId: outboundThreadIdForProvider({
                                    provider: message.provider,
                                    isDirectMessage,
                                    canonicalThreadId: conversationThreadId,
                                }),
                                content,
                            },
                        ];
                    }
                },
            });
            return await renderResponses(responses);
        } catch (error) {
            logger.error("Error running serialized conversation turn", {
                error,
                provider: message.provider,
                channelId,
                threadId: canonicalThreadId,
                resolvedUserId: user.id,
            });
            return await renderResponses([
                {
                    targetChannelId: message.context.channelId,
                    targetThreadId: outboundThreadIdForProvider({
                        provider: message.provider,
                        isDirectMessage,
                        canonicalThreadId,
                    }),
                    content: internalIssueMessage(),
                },
            ]);
        }
    }

    /**
     * Pushes a message to the user's active channel (Slack/Discord).
     * Uses the most recent conversation to determine where to send.
     */
    async pushMessage(userId: string, content: string): Promise<boolean> {
        try {
            // Prefer the most recent surfaces message metadata for precise channel/thread routing.
            const recentMessage = await prisma.conversationMessage.findFirst({
                where: {
                    userId: userId,
                    provider: "slack"
                },
                orderBy: { createdAt: "desc" },
                select: {
                    provider: true,
                    channelId: true,
                    threadId: true,
                    conversationId: true,
                },
            });

            // Fallback to conversation record if no message exists yet.
            const conversation = recentMessage
                ? {
                    provider: recentMessage.provider,
                    channelId: recentMessage.channelId,
                    threadId: recentMessage.threadId,
                    id: recentMessage.conversationId,
                }
                : await prisma.conversation.findFirst({
                    where: {
                        userId: userId,
                        provider: "slack"
                    },
                    orderBy: { updatedAt: "desc" }
                });

            if (!conversation) {
                logger.warn("No active conversation found for push", { userId });
                return false;
            }
            if (!conversation.channelId) {
                logger.warn("Active conversation missing channelId; cannot push", {
                    userId,
                    provider: conversation.provider,
                    conversationId: conversation.id,
                });
                return false;
            }

            const surfaceUrl = getSurfacesBaseUrl();
            const surfacesSecret = env.SURFACES_SHARED_SECRET;

            if (!surfaceUrl) {
                logger.warn("Surfaces worker URL unavailable; skipping notify", { userId });
                return false;
            }

            if (!surfacesSecret) {
                logger.warn("SURFACES_SHARED_SECRET not set; skipping notify", { userId });
                return false;
            }

            const responseId = createDeterministicIdempotencyKey(
                "surfaces-notify",
                userId,
                conversation.provider,
                conversation.channelId,
                conversation.threadId ?? "",
                content,
            );

            const response = await fetch(`${surfaceUrl}/notify`, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${surfacesSecret}`
                },
                body: JSON.stringify({
                    platform: conversation.provider,
                    channelId: conversation.channelId,
                    threadId: conversation.threadId,
                    content,
                    responseId,
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
