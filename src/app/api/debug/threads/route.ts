
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

export async function GET(req: NextRequest) {
    if (!checkAuth(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        // Fetch last 50 emails to find recent threads
        // We group by threadId implies we want unique threads
        // distinct is efficient in Prisma
        const threads = await prisma.emailMessage.findMany({
            distinct: ["threadId"],
            orderBy: {
                date: "desc",
            },
            take: 50,
            select: {
                threadId: true,
                // subject: true, // Not in schema
                from: true,
                date: true,
                // snippet: false, // Not in schema
                emailAccountId: true,
            },
        });

        return NextResponse.json({ count: threads.length, threads });
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error", details: String(error) },
            { status: 500 }
        );
    }
}
