import { Conversation, PrismaClient } from "@/generated/prisma/client";
import prisma from "@/server/db/client";
import { createHash } from "crypto";

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

        if (existing) {
            // If we want to enforce isPrimary logic on existing (e.g. upgrading it), we can.
            if (isPrimary && !existing.isPrimary) {
                return prisma.conversation.update({
                    where: { id: existing.id },
                    data: { isPrimary: true }
                });
            }
            return existing;
        }

        // Create
        return prisma.conversation.create({
            data: {
                userId,
                provider,
                channelId: channelId || null,
                threadId: threadId || null,
                isPrimary
            }
        });
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

        if (existing) return existing;

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
