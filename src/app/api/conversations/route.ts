import { NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { auth } from "@/server/auth";

export async function GET(req: Request) {
    const session = await auth();
    if (!session?.user?.id) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    // Parse pagination (optional)
    // const { searchParams } = new URL(req.url);

    const conversations = await prisma.conversation.findMany({
        where: {
            userId: session.user.id
        },
        orderBy: {
            updatedAt: "desc"
        },
        take: 50 // Limit 50
    });

    return NextResponse.json(conversations);
}
