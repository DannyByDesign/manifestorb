import prisma from "@/server/db/client";
import { env } from "@/env";

export class SummaryService {
    static async shouldSummarize(conversationId: string): Promise<boolean> {
        // Rule: Summarize if > 10 messages since last summary.

        // 0. Privacy Check
        // If user disabled recording, we shouldn't be summarizing either (matches "Incognito" expectation)
        const { PrivacyService } = await import("@/server/privacy/service");
        const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
        if (!conversation) return false;

        const shouldRecord = await PrivacyService.shouldRecord(conversation.userId);
        if (!shouldRecord) return false;

        // 1. Get last summary time
        const summary = await prisma.conversationSummary.findUnique({
            where: { conversationId }
        });

        const lastMessageAt = summary?.lastMessageAt || new Date(0);

        // 2. Count messages since then
        const count = await prisma.conversationMessage.count({
            where: {
                conversationId,
                createdAt: { gt: lastMessageAt }
            }
        });

        return count >= 10;
    }

    static async enqueueSummarizeConversation(conversationId: string) {
        // If QStash, use it. Else fetch internal endpoint async.
        // Assuming no QStash client ready in this context yet, using reliable fetch.

        const baseUrl = env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const endpoint = `${baseUrl}/api/jobs/summarize-conversation`;
        const secret = env.JOBS_SHARED_SECRET;

        if (!secret) {
            console.warn("Skipping summary enqueue: JOBS_SHARED_SECRET not set");
            return;
        }

        // Fire and forget
        fetch(endpoint, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${secret}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ conversationId })
        }).catch(err => console.error("Failed to enqueue summary job", err));
    }
}
