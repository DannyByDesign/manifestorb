import { NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { auth } from "@/server/auth";
import { z } from "zod";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("api/conversations/messages");

// Zod schema for query parameter validation
const messagesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
});

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const { id: conversationId } = await params;

        // Verify ownership
        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId }
        });

        if (!conversation || conversation.userId !== session.user.id) {
            return new NextResponse("Not Found", { status: 404 });
        }

        const { searchParams } = new URL(req.url);
        
        // Validate query parameters with Zod
        const parseResult = messagesQuerySchema.safeParse({
            limit: searchParams.get("limit"),
            cursor: searchParams.get("cursor"),
        });
        
        if (!parseResult.success) {
            logger.warn("Invalid query parameters", { errors: parseResult.error.issues });
            return NextResponse.json(
                { error: "Invalid query parameters", details: parseResult.error.issues },
                { status: 400 }
            );
        }
        
        const { limit, cursor } = parseResult.data;

        const messages = await prisma.conversationMessage.findMany({
            where: {
                conversationId
            },
            orderBy: {
                createdAt: "desc" // Newest first
            },
            take: limit + 1, // Fetch one extra for cursor
            cursor: cursor ? { id: cursor } : undefined
        });

        let nextCursor: string | undefined = undefined;
        if (messages.length > limit) {
            const nextItem = messages.pop();
            nextCursor = nextItem?.id;
        }

        return NextResponse.json({
            items: messages.reverse(), // Client wants oldest -> newest generally, or handled by UI
            nextCursor
        });
    } catch (err) {
        logger.error("Error fetching messages", { error: err });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
