
import { NextRequest, NextResponse } from "next/server";
import { ChannelRouter } from "@/server/channels/router";
import { z } from "zod";
import { createScopedLogger } from "@/server/utils/logger";

const logger = createScopedLogger("api/surfaces/inbound");

// Ensure this environment variable is defined in your schema
const SHARED_SECRET = process.env.SURFACES_SHARED_SECRET;

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

const inboundMessageSchema = z.object({
    provider: z.enum(["slack", "discord", "telegram", "web"]),
    content: z.string().min(1),
    context: inboundMessageContextSchema,
    attachments: z.array(inboundAttachmentSchema).optional(),
    history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
    })).optional(),
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

        // 2. Route Message
        const router = new ChannelRouter();
        const responses = await router.handleInbound(message);

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
