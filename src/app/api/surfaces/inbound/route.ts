
import { NextRequest, NextResponse } from "next/server";
import { ChannelRouter } from "@/features/channels/router";
import { z } from "zod";
import { createScopedLogger } from "@/server/lib/logger";
import { env } from "@/env";

const logger = createScopedLogger("api/surfaces/inbound");

// Ensure this environment variable is defined in your schema
const SHARED_SECRET = env.SURFACES_SHARED_SECRET;

// Zod schema for runtime validation
const inboundMessageContextSchema = z.object({
    workspaceId: z.string().optional(),
    channelId: z.string().min(1),
    channelName: z.string().optional(),
    threadId: z.string().optional(),
    userId: z.string().min(1),
    userName: z.string().optional(),
    messageId: z.string().min(1),
    isDirectMessage: z.boolean(),
});

const inboundAttachmentSchema = z.object({
    type: z.enum(["image", "file"]),
    url: z.string().url(),
    name: z.string().optional(),
    mimeType: z.string().optional(),
});

const inboundHistoryMessageSchema = z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.unknown(),
});

const inboundMessageSchema = z.object({
    provider: z.enum(["slack", "discord", "telegram", "web"]),
    content: z.string().min(1),
    context: inboundMessageContextSchema,
    history: z.array(inboundHistoryMessageSchema).max(100).optional(),
    attachments: z.array(inboundAttachmentSchema).optional(),
});

export async function POST(req: NextRequest) {
    // 1. Auth Check
    const authHeader = req.headers.get("x-surfaces-secret");
    const authBearer = req.headers.get("authorization")?.replace("Bearer ", "");

    if (!SHARED_SECRET || (authHeader !== SHARED_SECRET && authBearer !== SHARED_SECRET)) {
        if (!SHARED_SECRET) logger.warn("SURFACES_SHARED_SECRET not set!");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        
        // Validate request body with Zod
        const parseResult = inboundMessageSchema.safeParse(body);
        if (!parseResult.success) {
            logger.warn("Invalid request body", { errors: parseResult.error.issues });
            return NextResponse.json(
                { error: "Invalid request body", details: parseResult.error.issues },
                { status: 400 }
            );
        }
        
        const message = parseResult.data;
        logger.info("Accepted inbound surface message", {
            provider: message.provider,
            externalUserId: message.context.userId,
            channelId: message.context.channelId,
            messageId: message.context.messageId,
            isDirectMessage: message.context.isDirectMessage,
            contentLength: message.content.length,
            historyCount: message.history?.length ?? 0,
            attachmentsCount: message.attachments?.length ?? 0,
        });

        // 2. Route Message
        const router = new ChannelRouter();
        const routedResponses = await router.handleInbound(message);
        const responses =
            routedResponses.length > 0
                ? routedResponses
                : [
                      {
                          targetChannelId: message.context.channelId,
                          targetThreadId: message.context.threadId,
                          content:
                              "I hit an unexpected issue generating a reply. Please try again in a moment.",
                      },
                  ];
        if (routedResponses.length === 0) {
            logger.error("Router returned zero surface responses; using fallback response", {
                provider: message.provider,
                externalUserId: message.context.userId,
                channelId: message.context.channelId,
                messageId: message.context.messageId,
            });
        }
        logger.info("Returning surface responses", {
            provider: message.provider,
            externalUserId: message.context.userId,
            channelId: message.context.channelId,
            responsesCount: responses.length,
            hasInteractive: responses.some((response) => Boolean(response.interactive)),
        });

        // 3. Return Outbound Messages
        return NextResponse.json({ responses });
    } catch (err) {
        logger.error("Error in surfaces/inbound", { error: err });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
