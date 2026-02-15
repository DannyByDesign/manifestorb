import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createScopedLogger } from "@/server/lib/logger";
import { env } from "@/env";
import { redis } from "@/server/lib/redis";

const logger = createScopedLogger("api/surfaces/inbound/ack");
const SHARED_SECRET = env.SURFACES_SHARED_SECRET;
const ACK_TTL_SECONDS = Math.max(300, Number(process.env.SURFACES_DELIVERY_ACK_TTL_SECONDS || 7 * 24 * 60 * 60));
const ACK_KEY_PREFIX = "surfaces:delivery:ack";

const ackSchema = z.object({
    responseId: z.string().min(1),
    provider: z.enum(["slack", "discord", "telegram", "web"]).optional(),
    providerMessageId: z.string().optional(),
    channelId: z.string().optional(),
    threadId: z.string().optional(),
});

function ackKey(responseId: string): string {
    return `${ACK_KEY_PREFIX}:${responseId}`;
}

function isRedisConfigured(): boolean {
    return Boolean(env.UPSTASH_REDIS_URL && env.UPSTASH_REDIS_TOKEN);
}

export async function POST(req: NextRequest) {
    const authHeader = req.headers.get("x-surfaces-secret");
    const authBearer = req.headers.get("authorization")?.replace("Bearer ", "");

    if (!SHARED_SECRET || (authHeader !== SHARED_SECRET && authBearer !== SHARED_SECRET)) {
        if (!SHARED_SECRET) logger.warn("SURFACES_SHARED_SECRET not set!");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const parsed = ackSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid request body", details: parsed.error.issues },
                { status: 400 },
            );
        }

        const payload = {
            responseId: parsed.data.responseId,
            provider: parsed.data.provider ?? null,
            providerMessageId: parsed.data.providerMessageId ?? null,
            channelId: parsed.data.channelId ?? null,
            threadId: parsed.data.threadId ?? null,
            acknowledgedAt: new Date().toISOString(),
        };

        if (isRedisConfigured()) {
            await redis.set(
                ackKey(parsed.data.responseId),
                JSON.stringify(payload),
                { ex: ACK_TTL_SECONDS },
            );
        }

        logger.info("Recorded surface delivery ack", {
            responseId: parsed.data.responseId,
            provider: parsed.data.provider ?? "unknown",
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        logger.error("Failed to record surface delivery ack", { error });
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal Server Error" },
            { status: 500 },
        );
    }
}
