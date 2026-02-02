/**
 * Memory Recording Service
 * 
 * Unified module for user-level summarization and fact extraction.
 * Triggers based on token count (industry-standard 75% threshold).
 * 
 * UNIFIED MEMORY: Records are at the user level, not conversation level.
 * This ensures the assistant is "one person" across all platforms.
 * 
 * Based on research into coding agents (Forge, Cursor, etc.):
 * - Forge recommends 150-180K tokens for 200K context models
 * - We use 120K to leave room for system prompt, tools, email context
 */
import prisma from "@/server/db/client";
import { env } from "@/env";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("MemoryRecordingService");

// ============================================================================
// Configuration
// ============================================================================

// Industry-standard threshold: ~75% of available context capacity
// Available context: 200K - 40K (system/tools/email) = ~160K
// 75% of 160K = ~120K tokens
const TOKEN_THRESHOLD = 120_000;

// Rate limiting - don't record too frequently even if threshold is met
const RECORDING_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes minimum between recordings

// Token estimation: ~4 characters per token (conservative estimate)
const CHARS_PER_TOKEN = 4;

// ============================================================================
// Service
// ============================================================================

export class MemoryRecordingService {
    /**
     * Determine if memory recording should be triggered for a user
     * 
     * UNIFIED: Checks all user messages across ALL platforms/conversations.
     * 
     * Rules:
     * 1. User must have recording enabled (privacy)
     * 2. At least RECORDING_COOLDOWN_MS since last recording
     * 3. Unsummarized content exceeds TOKEN_THRESHOLD
     */
    static async shouldRecord(userId: string): Promise<boolean> {
        // 0. Privacy Check
        const { PrivacyService } = await import("@/features/privacy/service");
        const shouldRecordPrivacy = await PrivacyService.shouldRecord(userId);
        if (!shouldRecordPrivacy) {
            logger.trace("Skipping recording: privacy disabled", { userId });
            return false;
        }

        // 1. Get last user-level recording
        const userSummary = await prisma.userSummary.findUnique({
            where: { userId }
        });

        // 2. Rate limit check - don't record too frequently
        if (userSummary) {
            const timeSinceLastRecording = Date.now() - userSummary.updatedAt.getTime();
            if (timeSinceLastRecording < RECORDING_COOLDOWN_MS) {
                logger.trace("Skipping recording: rate limited", { 
                    userId, 
                    timeSinceLastMs: timeSinceLastRecording,
                    cooldownMs: RECORDING_COOLDOWN_MS
                });
                return false;
            }
        }

        const lastMessageAt = userSummary?.lastMessageAt || new Date(0);

        // 3. Calculate token count of unsummarized messages (across ALL conversations)
        const unsummarizedMessages = await prisma.conversationMessage.findMany({
            where: {
                userId,  // UNIFIED: All user messages, not per-conversation
                createdAt: { gt: lastMessageAt }
            },
            select: { content: true }
        });

        if (unsummarizedMessages.length === 0) {
            return false;
        }

        const totalChars = unsummarizedMessages.reduce(
            (sum, m) => sum + (m.content?.length || 0), 
            0
        );
        const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);

        // Pure token-based trigger
        if (estimatedTokens >= TOKEN_THRESHOLD) {
            logger.info("Memory recording triggered", { 
                userId, 
                estimatedTokens,
                messageCount: unsummarizedMessages.length,
                threshold: TOKEN_THRESHOLD
            });
            return true;
        }

        logger.trace("Recording not yet needed", {
            userId,
            estimatedTokens,
            threshold: TOKEN_THRESHOLD,
            percentFull: Math.round((estimatedTokens / TOKEN_THRESHOLD) * 100)
        });

        return false;
    }

    /**
     * Enqueue a memory recording job for a user
     * 
     * UNIFIED: Records at the user level, not conversation level.
     */
    static async enqueueMemoryRecording(userId: string, email: string) {
        const baseUrl = env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const endpoint = `${baseUrl}/api/jobs/record-memory`;
        const secret = env.JOBS_SHARED_SECRET;

        if (!secret) {
            console.warn("Skipping memory recording enqueue: JOBS_SHARED_SECRET not set");
            return;
        }

        // Fire and forget
        fetch(endpoint, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${secret}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ userId, email })  // User-level, not conversation-level
        }).catch(err => console.error("Failed to enqueue memory recording job", err));
    }

    /**
     * Get statistics about unsummarized content for a user
     * 
     * UNIFIED: Spans all user conversations.
     */
    static async getRecordingStats(userId: string): Promise<{
        estimatedTokens: number;
        messageCount: number;
        percentFull: number;
        shouldRecord: boolean;
    }> {
        const userSummary = await prisma.userSummary.findUnique({
            where: { userId }
        });

        const lastMessageAt = userSummary?.lastMessageAt || new Date(0);

        const unsummarizedMessages = await prisma.conversationMessage.findMany({
            where: {
                userId,  // UNIFIED: All user messages
                createdAt: { gt: lastMessageAt }
            },
            select: { content: true }
        });

        const totalChars = unsummarizedMessages.reduce(
            (sum, m) => sum + (m.content?.length || 0), 
            0
        );
        const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);

        return {
            estimatedTokens,
            messageCount: unsummarizedMessages.length,
            percentFull: Math.round((estimatedTokens / TOKEN_THRESHOLD) * 100),
            shouldRecord: estimatedTokens >= TOKEN_THRESHOLD
        };
    }
}

// ============================================================================
// Backwards Compatibility (deprecated)
// ============================================================================

/**
 * @deprecated Use MemoryRecordingService with userId instead
 */
export class SummaryService {
    static async shouldSummarize(conversationId: string): Promise<boolean> {
        // Legacy: Look up userId from conversation
        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            select: { userId: true }
        });
        if (!conversation) return false;
        return MemoryRecordingService.shouldRecord(conversation.userId);
    }

    static async enqueueSummarizeConversation(conversationId: string) {
        // Legacy: Look up userId and email from conversation
        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { user: { select: { email: true } } }
        });
        if (!conversation) return;
        return MemoryRecordingService.enqueueMemoryRecording(
            conversation.userId,
            conversation.user.email
        );
    }
}
