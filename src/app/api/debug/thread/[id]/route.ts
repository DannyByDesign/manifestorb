
import { NextResponse } from "next/server";
import { type NextRequest } from "next/server";
import prisma from "@/server/db/client";
import { env } from "@/env";

export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest) {
    const adminToken = req.headers.get("x-admin-token");
    const isDev = process.env.NODE_ENV === "development";
    const isAdmin = env.ADMIN_TOKEN && adminToken === env.ADMIN_TOKEN;

    if (!isDev && !isAdmin) {
        return false;
    }
    return true;
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!checkAuth(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { id } = await params;

        const messages = await prisma.emailMessage.findMany({
            where: {
                threadId: id,
            },
            orderBy: {
                date: "asc",
            },
            include: {
                emailAccount: {
                    select: {
                        email: true,
                    },
                },
            },
        });

        if (messages.length === 0) {
            return NextResponse.json({ error: "Thread not found" }, { status: 404 });
        }

        return NextResponse.json({
            threadId: id,
            messageCount: messages.length,
            messages: messages.map((m) => ({
                id: m.id,
                messageId: m.messageId,
                from: m.from,
                to: m.to,
                subject: "Subject not in DB", // Schema does not have subject on EmailMessage
                date: m.date,
                snippet: "...", // Schema doesn't have snippet.
            })),
        });
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: String(error) },
            { status: 500 }
        );
    }
}
