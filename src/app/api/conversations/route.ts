
import { NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { getServerSession } from "next-auth"; // Adjust auth import based on project
import { authOptions } from "@/server/auth"; // Adjust based on project

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);
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
