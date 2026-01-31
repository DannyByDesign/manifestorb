
import { NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";

export async function GET(
    req: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    const conversationId = params.id;

    // Verify ownership
    const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId }
    });

    if (!conversation || conversation.userId !== session.user.id) {
        return new NextResponse("Not Found", { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const cursor = searchParams.get("cursor"); // ID-based cursor

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
}
