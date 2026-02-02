
import { NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { createGenerateText } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { env } from "@/env";
import { z } from "zod";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("api/jobs/summarize-conversation");

// Zod schema for request validation
const summarizeConversationBodySchema = z.object({
    conversationId: z.string().min(1),
});

export async function POST(req: Request) {
    try {
        const authHeader = req.headers.get("Authorization");
        if (authHeader !== `Bearer ${env.JOBS_SHARED_SECRET}`) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const body = await req.json();
        
        // Validate request body with Zod
        const parseResult = summarizeConversationBodySchema.safeParse(body);
        if (!parseResult.success) {
            logger.warn("Invalid request body", { errors: parseResult.error.issues });
            return NextResponse.json(
                { error: "Invalid request body", details: parseResult.error.issues },
                { status: 400 }
            );
        }
        
        const { conversationId } = parseResult.data;

        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { user: true }
        });

        if (!conversation) return new NextResponse("Conversation not found", { status: 404 });

        // 1. Build Context for Summarizer
        // Fetch last summary
        const existingSummary = await prisma.conversationSummary.findUnique({
            where: { conversationId }
        });

        const lastMessageAt = existingSummary?.lastMessageAt || new Date(0);

        // Fetch new messages
        const newMessages = await prisma.conversationMessage.findMany({
            where: {
                conversationId,
                createdAt: { gt: lastMessageAt }
            },
            orderBy: { createdAt: "asc" }
        });

        if (newMessages.length === 0) {
            return NextResponse.json({ skipped: true, reason: "No new messages" });
        }

        // 2. Generate Summary
        // We use a cheap fast model for summarization if possible, or main model.
        const user = conversation.user;
        const modelOptions = getModel({
            aiProvider: user.aiProvider || "openai",
            aiModel: "gpt-4o-mini", // Prefer fast model
            aiApiKey: user.aiApiKey,
        } as any);

        const generate = createGenerateText({
            emailAccount: { userId: user.id } as any, // Mock for utility
            label: "summary-job",
            modelOptions
        });

        const prompt = `
        You are a precise Conversation Summarizer.
        Update the Reference Summary based on the New Messages.

        CURRENT SUMMARY:
        ${existingSummary?.summary || "No prior summary."}

        NEW MESSAGES:
        ${newMessages.map(m => `${m.role}: ${m.content}`).join("\n")}

        OUTPUT FORMAT:
        Produce a concise markdown summary with these sections:
        ## User Preferences
        (Any permanent preferences detected)
        ## Open Tasks
        (Pending items)
        ## Recent Context
        (What just happened)
        
        Keep it mostly factual. Merge new info into old summary.
        `;

        const result = await generate({
            model: modelOptions.model,
            messages: [{ role: "user", content: prompt }]
        } as any);

        // 3. Save
        const newestDate = newMessages[newMessages.length - 1].createdAt;

        await prisma.conversationSummary.upsert({
            where: { conversationId },
            update: {
                summary: result.text,
                lastMessageAt: newestDate
            },
            create: {
                conversationId,
                summary: result.text,
                lastMessageAt: newestDate
            }
        });

        return NextResponse.json({ success: true, updated: true });
    } catch (err) {
        logger.error("Error summarizing conversation", { error: err });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
