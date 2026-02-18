import { NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { z } from "zod";
import { deriveCanonicalThreadId } from "@/features/channels/conversation-key";
import { resolveSurfaceAccount } from "@/features/channels/surface-account";
import { env } from "@/env";

const logger = createScopedLogger("api/surfaces/context");
const SHARED_SECRET = env.SURFACES_SHARED_SECRET;

const bodySchema = z.object({
    provider: z.enum(["slack", "discord", "telegram", "web"]),
    providerAccountId: z.string().min(1),
    providerTeamId: z.string().optional(),
    channelId: z.string().min(1),
    isDirectMessage: z.boolean().optional(),
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
            providerTeamId,
            channelId,
            isDirectMessage,
            incomingThreadId,
            messageId,
        } = parsed.data;
        let canonicalThreadId = deriveCanonicalThreadId({
            provider,
            isDirectMessage,
            incomingThreadId,
            messageId,
        });

        const accountResolution = await resolveSurfaceAccount({
            provider,
            providerAccountId,
            workspaceId: providerTeamId,
        });
        const accountUserId = accountResolution.userId;

        if (!accountUserId) {
            return NextResponse.json({
                linked: false,
                canonicalThreadId,
                resolutionStatus: accountResolution.resolutionStatus,
                ...(accountResolution.reason ? { reason: accountResolution.reason } : {}),
            });
        }

        let conversation = await prisma.conversation.findFirst({
            where: {
                userId: accountUserId,
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

        // Slack sometimes omits thread_ts on inbound events. In that case, recover
        // the most recent canonical thread for this user/channel so replies stay in
        // a single continuous assistant conversation.
        if (!conversation && !incomingThreadId) {
            const latestConversation = await prisma.conversation.findFirst({
                where: {
                    userId: accountUserId,
                    provider,
                    channelId,
                    threadId: { not: null },
                },
                orderBy: {
                    updatedAt: "desc",
                },
                select: {
                    id: true,
                    channelId: true,
                    threadId: true,
                },
            });
            if (latestConversation?.threadId) {
                canonicalThreadId = latestConversation.threadId;
                conversation = latestConversation;
            }
        }

        return NextResponse.json({
            linked: true,
            canonicalThreadId,
            conversationId: conversation?.id ?? null,
            canonicalChannelId: conversation?.channelId ?? channelId,
        });
    } catch (error) {
        logger.error("Failed to resolve canonical surfaces context", {
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 },
        );
    }
}
