
import { NextRequest, NextResponse } from "next/server";
import { ChannelRouter } from "@/features/channels/router";
import type { OutboundMessage } from "@/features/channels/types";
import { z } from "zod";
import { createScopedLogger } from "@/server/lib/logger";
import { env } from "@/env";
import { createDeterministicIdempotencyKey } from "@/server/lib/idempotency";
import { redis } from "@/server/lib/redis";

const logger = createScopedLogger("api/surfaces/inbound");

// Ensure this environment variable is defined in your schema
const SHARED_SECRET = env.SURFACES_SHARED_SECRET;
const IDEMPOTENCY_CACHE_TTL_SECONDS = Math.max(
    60,
    Number(process.env.SURFACES_INBOUND_IDEMPOTENCY_TTL_SECONDS || 6 * 60 * 60),
);
const IDEMPOTENCY_CACHE_PREFIX = "surfaces:inbound:idempotency";

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
    idempotencyKey: z.string().min(1).max(256).optional(),
});

function isRedisConfigured(): boolean {
    return Boolean(env.UPSTASH_REDIS_URL && env.UPSTASH_REDIS_TOKEN);
}

function cacheKeyForIdempotency(idempotencyKey: string): string {
    return `${IDEMPOTENCY_CACHE_PREFIX}:${idempotencyKey}`;
}

function normalizeIdempotencyKey(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function computeDefaultIdempotencyKey(message: {
    provider: "slack" | "discord" | "telegram" | "web";
    context: {
        workspaceId?: string;
        channelId: string;
        userId: string;
        messageId: string;
    };
}): string {
    return createDeterministicIdempotencyKey(
        "surfaces-inbound",
        message.provider,
        message.context.workspaceId ?? "",
        message.context.channelId,
        message.context.userId,
        message.context.messageId,
    );
}

function resolveIdempotencyKey(
    req: NextRequest,
    bodyIdempotencyKey: string | undefined,
    message: {
        provider: "slack" | "discord" | "telegram" | "web";
        context: {
            workspaceId?: string;
            channelId: string;
            userId: string;
            messageId: string;
        };
    },
): string {
    const headerKey =
        normalizeIdempotencyKey(req.headers.get("idempotency-key")) ??
        normalizeIdempotencyKey(req.headers.get("x-idempotency-key"));
    if (headerKey) return headerKey;

    const bodyKey = normalizeIdempotencyKey(bodyIdempotencyKey);
    if (bodyKey) return bodyKey;

    return computeDefaultIdempotencyKey(message);
}

function withStableResponseIds(
    responses: OutboundMessage[],
    idempotencyKey: string,
): OutboundMessage[] {
    return responses.map((response, index) => {
        if (response.responseId) return response;

        return {
            ...response,
            responseId: createDeterministicIdempotencyKey(
                "surfaces-outbound",
                idempotencyKey,
                index,
                response.targetChannelId,
                response.targetThreadId ?? "",
                response.content,
                response.interactive ?? null,
            ),
        };
    });
}

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
        
        const { idempotencyKey: bodyIdempotencyKey, ...message } = parseResult.data;
        const idempotencyKey = resolveIdempotencyKey(req, bodyIdempotencyKey, message);
        const canUseRedis = isRedisConfigured();

        if (canUseRedis) {
            try {
                const cached = await redis.get<string>(cacheKeyForIdempotency(idempotencyKey));
                if (cached) {
                    const cachedPayload = JSON.parse(cached) as { responses: OutboundMessage[] };
                    logger.info("Returning cached surface response for idempotency key", {
                        provider: message.provider,
                        externalUserId: message.context.userId,
                        channelId: message.context.channelId,
                        messageId: message.context.messageId,
                    });
                    return NextResponse.json(
                        { responses: cachedPayload.responses },
                        {
                            headers: {
                                "x-idempotency-key": idempotencyKey,
                                "x-idempotency-cache": "hit",
                            },
                        },
                    );
                }
            } catch (error) {
                logger.warn("Failed to read idempotency cache", { error });
            }
        }

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
        const responsesWithoutIds =
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
        const responses = withStableResponseIds(responsesWithoutIds, idempotencyKey);
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
            idempotencyKey,
            responsesCount: responses.length,
            hasInteractive: responses.some((response) => Boolean(response.interactive)),
        });

        if (canUseRedis) {
            try {
                await redis.set(
                    cacheKeyForIdempotency(idempotencyKey),
                    JSON.stringify({ responses }),
                    { ex: IDEMPOTENCY_CACHE_TTL_SECONDS },
                );
            } catch (error) {
                logger.warn("Failed to write idempotency cache", { error });
            }
        }

        // 3. Return Outbound Messages
        return NextResponse.json(
            { responses },
            {
                headers: {
                    "x-idempotency-key": idempotencyKey,
                    "x-idempotency-cache": "miss",
                },
            },
        );
    } catch (err) {
        logger.error("Error in surfaces/inbound", { error: err });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
