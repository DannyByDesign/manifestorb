import { Conversation } from "@/generated/prisma/client";
import prisma from "@/server/db/client";
import { createHash } from "crypto";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("ConversationService");

function isMissingTableError(error: unknown): boolean {
    const code =
        typeof error === "object" && error !== null && "code" in error
            ? (error as { code?: unknown }).code
            : undefined;
    return code === "P2021";
}

export class ConversationService {
    static async ensureConversation({
        userId,
        provider,
        channelId,
        threadId,
        isPrimary = false
    }: {
        userId: string;
        provider: string;
        channelId?: string | null;
        threadId?: string | null;
        isPrimary?: boolean;
    }): Promise<Conversation> {
        // Unique constraint is [userId, provider, channelId, threadId]
        // But channelId/threadId can be null, which Postgres handles uniquely only if we use logic or specific constraints.
        // Prisma treats multiple nulls as unique violations depending on DB. 
        // Best to use findFirst to be safe with nullable fields, then upsert if possible or create.

        // Actually, for "web", channel/thread are null.
        // Let's try to find it first.
        const existing = await prisma.conversation.findFirst({
            where: {
                userId,
                provider,
                channelId: channelId || null,
                threadId: threadId || null
            }
        });

        let conversation: Conversation;

        if (existing) {
            // If we want to enforce isPrimary logic on existing (e.g. upgrading it), we can.
            if (isPrimary && !existing.isPrimary) {
                conversation = await prisma.conversation.update({
                    where: { id: existing.id },
                    data: { isPrimary: true }
                });
            } else {
                conversation = existing;
            }
        } else {
            // Create
            conversation = await prisma.conversation.create({
                data: {
                    userId,
                    provider,
                    channelId: channelId || null,
                    threadId: threadId || null,
                    isPrimary
                }
            });
        }

        await this.ensureUnifiedConversationLink({
            userId,
            conversationId: conversation.id,
            provider,
            channelId: channelId || null,
            threadId: threadId || null,
        });

        return conversation;
    }

    static async getPrimaryWebConversation(userId: string): Promise<Conversation> {
        const existing = await prisma.conversation.findFirst({
            where: {
                userId,
                provider: "web",
                channelId: "web-primary-channel",
                isPrimary: true
            }
        });

        if (existing) {
            await this.ensureUnifiedConversationLink({
                userId,
                conversationId: existing.id,
                provider: "web",
                channelId: existing.channelId ?? "web-primary-channel",
                threadId: existing.threadId ?? "root",
            });
            return existing;
        }

        // Create primary web conversation
        // we use sentinel strings to ensure Postgres unique constraints work (nulls are not unique-checked)
        return this.ensureConversation({
            userId,
            provider: "web",
            channelId: "web-primary-channel",
            threadId: "root",
            isPrimary: true
        });
    }

    static async ensureUnifiedConversationLink(params: {
        userId: string;
        conversationId: string;
        provider: string;
        channelId?: string | null;
        threadId?: string | null;
    }): Promise<void> {
        try {
            await prisma.$transaction(async (tx) => {
                const existingLink = await tx.unifiedConversationLink.findUnique({
                    where: { conversationId: params.conversationId },
                    select: { id: true },
                });
                if (existingLink) return;

                let unified = await tx.unifiedConversation.findFirst({
                    where: { userId: params.userId, status: "active" },
                    orderBy: { createdAt: "asc" },
                    select: { id: true },
                });

                if (!unified) {
                    unified = await tx.unifiedConversation.create({
                        data: {
                            userId: params.userId,
                            status: "active",
                            retentionMode: "keep_active_tail",
                        },
                        select: { id: true },
                    });
                }

                await tx.unifiedConversationLink.create({
                    data: {
                        unifiedConversationId: unified.id,
                        conversationId: params.conversationId,
                        provider: params.provider,
                        channelId: params.channelId ?? null,
                        threadId: params.threadId ?? null,
                    },
                });
            });
        } catch (error) {
            if (isMissingTableError(error)) {
                return;
            }
            logger.warn("Failed to ensure unified conversation link", {
                userId: params.userId,
                conversationId: params.conversationId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    static computeDedupeKey({
        provider,
        channelId,
        threadId,
        providerMessageId, // can be null for web
        role,
        contentHash, // if no message ID, use hash of content + timestamp context
        userId
    }: {
        provider: string;
        channelId?: string | null;
        threadId?: string | null;
        providerMessageId?: string | null;
        role: string;
        contentHash?: string;
        userId?: string;
    }): string {
        const parts = [
            provider,
            channelId || "no-channel",
            threadId || "no-thread",
            role
        ];

        if (providerMessageId) {
            parts.push(providerMessageId);
        } else if (contentHash) {
            // For web or un-ID'd messages, use content hash + roughly timestamp if needed (passed in contentHash or handled by caller)
            parts.push(contentHash);
        } else {
            // Fallback (unsafe but better than crash)
            parts.push(`fallback-${Date.now()}-${Math.random()}`);
        }

        return createHash("sha256").update(parts.join(":")).digest("hex");
    }
}
