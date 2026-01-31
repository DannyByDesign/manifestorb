
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import prisma from "@/server/db/client";

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });

    // Confirm deletion of ALL user conversations and messages?
    // Or just messages? The requirement says "deletes ALL messages for this user".
    // Conversations can stay but be empty, or be deleted too. Let's delete msgs.

    await prisma.conversationMessage.deleteMany({
        where: { userId: session.user.id }
    });

    return NextResponse.json({ success: true, count: "all" });
}
