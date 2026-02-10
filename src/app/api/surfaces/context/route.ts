import { NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { z } from "zod";
import { deriveCanonicalThreadId } from "@/features/channels/conversation-key";

const logger = createScopedLogger("api/surfaces/context");
const SHARED_SECRET = process.env.SURFACES_SHARED_SECRET;

const bodySchema = z.object({
    provider: z.enum(["slack", "discord", "telegram", "web"]),
    providerAccountId: z.string().min(1),
    channelId: z.string().min(1),
    incomingThreadId: z.string().optional(),
    messageId: z.string().optional(),
});

export async function POST(req: NextRequest) {
    const authHeader = req.headers.get("x-surfaces-secret");
    const authBearer = req.headers.get("authorization")?.replace("Bearer ", "");

    if (!SHARED_SECRET || (authHeader !== SHARED_SECRET && authBearer !== SHARED_SECRET)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid body", details: parsed.error.issues },
                { status: 400 },
            );
        }

        const {
            provider,
            providerAccountId,
            channelId,
            incomingThreadId,
            messageId,
        } = parsed.data;
        const canonicalThreadId = deriveCanonicalThreadId({
            provider,
            incomingThreadId,
            messageId,
        });

        const account = await prisma.account.findUnique({
            where: {
                provider_providerAccountId: {
                    provider,
                    providerAccountId,
                },
            },
            select: {
                userId: true,
            },
        });

        if (!account?.userId) {
            return NextResponse.json({
                linked: false,
                canonicalThreadId,
            });
        }

        const conversation = await prisma.conversation.findFirst({
            where: {
                userId: account.userId,
                provider,
                channelId,
                threadId: canonicalThreadId,
            },
            select: {
                id: true,
                channelId: true,
                threadId: true,
            },
        });

        return NextResponse.json({
            linked: true,
            canonicalThreadId,
            conversationId: conversation?.id ?? null,
            canonicalChannelId: conversation?.channelId ?? channelId,
        });
    } catch (error) {
        logger.error("Failed to resolve canonical sidecar context", {
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 },
        );
    }
}
