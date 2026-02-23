import { config } from "dotenv";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { startSlack, stopSlack } from "./connectors/slack";
import { startDiscord } from "./connectors/discord";
import { startTelegram } from "./connectors/telegram";
import { startScheduler, triggerEmbeddingJob, triggerDecayJob } from "./jobs/scheduler";
import { getQueueStats } from "./jobs/embedding-worker";
import { getDecayStats } from "./jobs/decay-worker";
import { processMemoryRecording } from "./jobs/recording-worker";
import { startBrainIngressWorker, stopBrainIngressWorker } from "./transport/brain-ingress";
import { env } from "./env";
import { prisma } from "./db/prisma";
import { redis } from "./db/redis";
import { getPlatformStatuses, setPlatformError, type PlatformName } from "./platform-status";
import {
    acknowledgeSurfacesWorkerDelivery,
    hasSurfacesWorkerResponseBeenDelivered,
    markSurfacesWorkerResponseDelivered,
} from "./delivery";

config();

function hasRequestBody(method: string): boolean {
    const upper = method.toUpperCase();
    return upper !== "GET" && upper !== "HEAD";
}

async function toWebRequest(req: IncomingMessage, fallbackPort: number): Promise<Request> {
    const forwardedProto = typeof req.headers["x-forwarded-proto"] === "string"
        ? req.headers["x-forwarded-proto"].split(",")[0]?.trim()
        : undefined;
    const protocol = forwardedProto || "http";
    const host = req.headers.host || `127.0.0.1:${fallbackPort}`;
    const url = new URL(req.url || "/", `${protocol}://${host}`);

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "undefined") continue;
        if (Array.isArray(value)) {
            for (const item of value) headers.append(key, item);
        } else {
            headers.set(key, value);
        }
    }

    const method = req.method || "GET";
    if (!hasRequestBody(method)) {
        return new Request(url.toString(), { method, headers });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    return new Request(url.toString(), {
        method,
        headers,
        body,
    });
}

async function writeNodeResponse(res: ServerResponse, response: Response): Promise<void> {
    res.statusCode = response.status;
    for (const [key, value] of response.headers.entries()) {
        const normalized = key.toLowerCase();
        if (normalized === "set-cookie") {
            const existing = res.getHeader(key);
            if (typeof existing === "undefined") {
                res.setHeader(key, [value]);
            } else if (Array.isArray(existing)) {
                res.setHeader(key, [...existing.map(String), value]);
            } else {
                res.setHeader(key, [String(existing), value]);
            }
            continue;
        }
        res.setHeader(key, value);
    }

    if (!response.body) {
        res.end();
        return;
    }

    const payload = Buffer.from(await response.arrayBuffer());
    res.end(payload);
}

type SurfacesWorkerServer = {
    stop: () => Promise<void>;
};

function startHttpServer(port: number): SurfacesWorkerServer {
    const bunRuntime = (globalThis as {
        Bun?: {
            serve: (options: {
                hostname?: string;
                port: number;
                fetch: typeof handleRequest;
            }) => { stop: () => void };
        };
    }).Bun;

    if (bunRuntime) {
        const bunServer = bunRuntime.serve({
            hostname: "0.0.0.0",
            port,
            fetch: handleRequest,
        });
        return {
            stop: async () => {
                bunServer.stop();
            },
        };
    }

    const nodeServer = createServer(async (req, res) => {
        try {
            const request = await toWebRequest(req, port);
            const response = await handleRequest(request);
            await writeNodeResponse(res, response);
        } catch (error) {
            console.error("[Surfaces] Node HTTP request handling failed", { error });
            if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
            }
            res.end("Internal Server Error");
        }
    });

    nodeServer.listen(port, "0.0.0.0");
    return {
        stop: () => new Promise((resolve, reject) => {
            nodeServer.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        }),
    };
}

export async function handleRequest(req: Request) {
    const url = new URL(req.url);
    const getPlatformReadiness = () => {
        const platforms = getPlatformStatuses();
        const failing = Object.entries(platforms)
            .filter(([, status]) => status.enabled && (!status.started || Boolean(status.lastError)))
            .map(([name]) => name);
        return {
            platforms,
            ready: failing.length === 0,
            failing,
        };
    };

    const isAuthorized = (expectedSecret: string | undefined) => {
        if (!expectedSecret) return false;
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) return false;
        const token = authHeader.replace("Bearer ", "");
        if (!token) return false;
        if (token.length !== expectedSecret.length) return false;
        return timingSafeEqual(Buffer.from(token), Buffer.from(expectedSecret));
    };

    const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
        return await new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
            promise
                .then((value) => {
                    clearTimeout(timer);
                    resolve(value);
                })
                .catch((error) => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    };

    // Push notifications to platforms
    if (req.method === "POST" && url.pathname === "/notify") {
        try {
            if (!isAuthorized(env.SURFACES_SHARED_SECRET)) {
                return new Response("Unauthorized", { status: 401 });
            }

            const body = await req.json();
            const { platform, channelId, threadId, content, responseId } = body as {
                platform?: "slack" | "discord" | "telegram";
                channelId?: string;
                threadId?: string;
                content?: string;
                responseId?: string;
            };

            if (!platform || !channelId || !content) {
                return new Response("Missing required fields", { status: 400 });
            }

            if (
                typeof responseId === "string" &&
                responseId.length > 0 &&
                await hasSurfacesWorkerResponseBeenDelivered({ provider: platform, responseId })
            ) {
                return new Response("Notification already delivered", { status: 200 });
            }

            let providerMessageId: string | undefined;
            if (platform === "slack") {
                const { sendSlackMessage } = await import("./connectors/slack");
                providerMessageId = await sendSlackMessage(channelId, content, undefined, threadId);
            } else if (platform === "discord") {
                const { sendDiscordMessage } = await import("./connectors/discord");
                providerMessageId = await sendDiscordMessage(channelId, content);
            } else if (platform === "telegram") {
                const { sendTelegramMessage } = await import("./connectors/telegram");
                providerMessageId = await sendTelegramMessage(channelId, content);
            } else {
                return new Response("Unsupported platform", { status: 400 });
            }

            if (typeof responseId === "string" && responseId.length > 0 && providerMessageId) {
                await markSurfacesWorkerResponseDelivered({
                    provider: platform,
                    responseId,
                });
                try {
                    await acknowledgeSurfacesWorkerDelivery({
                        responseId,
                        provider: platform,
                        providerMessageId,
                        channelId,
                        threadId,
                    });
                } catch (error) {
                    console.warn("[Surfaces] Failed to acknowledge notify delivery", {
                        platform,
                        channelId,
                        threadId: threadId ?? null,
                        responseId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            return new Response(`Notification sent to ${platform}`, { status: 200 });

        } catch (err) {
            console.error("Failed to process notification", err);
            return new Response("Internal Server Error", { status: 500 });
        }
    }

    // Send onboarding welcome to a user (e.g. Slack DM)
    if (req.method === "POST" && url.pathname === "/onboarding/linked") {
        try {
            if (!isAuthorized(env.SURFACES_SHARED_SECRET)) {
                return new Response("Unauthorized", { status: 401 });
            }

            const body = (await req.json()) as {
                provider?: string;
                providerAccountId?: string;
                providerTeamId?: string;
            };

            const provider = body.provider;
            const providerAccountId = body.providerAccountId;
            if (
                (provider !== "slack" && provider !== "discord" && provider !== "telegram") ||
                !providerAccountId
            ) {
                return new Response(
                    JSON.stringify({
                        ok: false,
                        error: "Requires provider ('slack'|'discord'|'telegram') and providerAccountId",
                    }),
                    { status: 400, headers: { "Content-Type": "application/json" } },
                );
            }

            if (provider === "slack") {
                const { sendLinkedToSlackUser } = await import("./connectors/slack");
                const result = await sendLinkedToSlackUser(providerAccountId);
                return new Response(JSON.stringify(result), {
                    status: result.ok ? 200 : 500,
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (provider === "discord") {
                const { sendLinkedToDiscordUser } = await import("./connectors/discord");
                const result = await sendLinkedToDiscordUser(providerAccountId);
                return new Response(JSON.stringify(result), {
                    status: result.ok ? 200 : 500,
                    headers: { "Content-Type": "application/json" },
                });
            }

            const { sendLinkedToTelegramUser } = await import("./connectors/telegram");
            const result = await sendLinkedToTelegramUser(providerAccountId);
            return new Response(JSON.stringify(result), {
                status: result.ok ? 200 : 500,
                headers: { "Content-Type": "application/json" },
            });
        } catch (err) {
            console.error("Failed to send onboarding linked message", err);
            return new Response(
                JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
                { status: 500, headers: { "Content-Type": "application/json" } },
            );
        }
    }

            // Internal pub/sub forwarder for clean updates
            if (req.method === "POST" && url.pathname === "/pubsub/clean") {
                try {
                    if (!isAuthorized(env.SURFACES_SHARED_SECRET)) {
                        return new Response("Unauthorized", { status: 401 });
                    }

                    if (!redis) {
                        return new Response("Redis not configured", { status: 503 });
                    }

                    const body = await req.json();
                    const { channel, payload } = body;
                    if (!channel || !payload) {
                        return new Response("Missing channel or payload", { status: 400 });
                    }

                    await redis.publish(channel, JSON.stringify(payload));
                    return new Response("Published", { status: 200 });
                } catch (err) {
                    console.error("Failed to publish clean update", err);
                    return new Response("Internal Server Error", { status: 500 });
                }
            }

            // Job status endpoint
            if (req.method === "GET" && url.pathname === "/jobs/status") {
                try {
                    const [embeddingStats, decayStats] = await Promise.all([
                        getQueueStats(),
                        getDecayStats()
                    ]);
                    
                    return new Response(JSON.stringify({
                        embedding: embeddingStats,
                        decay: decayStats
                    }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" }
                    });
                } catch (err) {
                    console.error("Failed to get job status", err);
                    return new Response("Internal Server Error", { status: 500 });
                }
            }

            // Manual job triggers (require auth)
            const isJobAuthorized = isAuthorized(env.JOBS_SHARED_SECRET);
            
            if (req.method === "POST" && url.pathname === "/jobs/embeddings") {
                if (!isJobAuthorized) {
                    return new Response("Unauthorized", { status: 401 });
                }
                
                try {
                    await triggerEmbeddingJob();
                    const stats = await getQueueStats();
                    return new Response(JSON.stringify({ success: true, stats }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" }
                    });
                } catch (err) {
                    console.error("Failed to trigger embedding job", err);
                    return new Response("Internal Server Error", { status: 500 });
                }
            }

            if (req.method === "POST" && url.pathname === "/jobs/decay") {
                if (!isJobAuthorized) {
                    return new Response("Unauthorized", { status: 401 });
                }
                
                try {
                    await triggerDecayJob();
                    const stats = await getDecayStats();
                    return new Response(JSON.stringify({ success: true, stats }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" }
                    });
                } catch (err) {
                    console.error("Failed to trigger decay job", err);
                    return new Response("Internal Server Error", { status: 500 });
                }
            }

            // Memory recording - immediate processing (fire and forget)
            if (req.method === "POST" && url.pathname === "/jobs/recording") {
                if (!isJobAuthorized) {
                    return new Response("Unauthorized", { status: 401 });
                }
                
                try {
                    const body = await req.json();
                    const { userId, email } = body;
                    
                    if (!userId || !email) {
                        return new Response("Missing userId or email", { status: 400 });
                    }
                    
                    // Fire off processing (don't await - return immediately)
                    processMemoryRecording(userId, email)
                        .then(result => {
                            if (result.success && result.stats) {
                                console.log(`[Recording] Complete for ${userId}: ${result.stats.factsExtracted} facts`);
                            } else if (result.skipped) {
                                console.log(`[Recording] Skipped for ${userId}: ${result.reason}`);
                            } else {
                                console.error(`[Recording] Failed for ${userId}: ${result.error}`);
                            }
                        })
                        .catch(err => console.error(`[Recording] Error for ${userId}:`, err));
                    
                    // Return immediately with 202 Accepted
                    return new Response(JSON.stringify({ queued: true, userId }), {
                        status: 202,
                        headers: { "Content-Type": "application/json" }
                    });
                } catch (err) {
                    console.error("Failed to trigger recording job", err);
                    return new Response("Internal Server Error", { status: 500 });
                }
            }

            // Liveness health checks (for Railway/container probes) must only
            // indicate whether the process can serve requests.
            if (req.method === "GET" && url.pathname === "/health/liveness") {
                const readiness = getPlatformReadiness();
                return new Response(JSON.stringify({
                    status: "alive",
                    uptime: process.uptime(),
                    ready: readiness.ready,
                    failingPlatforms: readiness.failing,
                }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }

            // Back-compat health endpoint used by docs/manual checks.
            if (req.method === "GET" && url.pathname === "/health") {
                const readiness = getPlatformReadiness();
                return new Response(JSON.stringify({
                    status: "ok",
                    uptime: process.uptime(),
                    ready: readiness.ready,
                    platforms: readiness.platforms,
                    failingPlatforms: readiness.failing,
                }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }

            // Readiness/dependency health check (for debugging/monitoring)
            if (req.method === "GET" && url.pathname === "/health/readiness") {
                let db = "ok";
                let redisStatus = "not_configured";
                let queueStats: { pending: number; processing: number; failed: number } | null = null;
                const readiness = getPlatformReadiness();

                try {
                    await withTimeout(prisma.$queryRaw`SELECT 1`, 1200);
                } catch (error) {
                    db = "error";
                    console.error("[Health] Database check failed", error);
                }

                if (redis) {
                    try {
                        await withTimeout(redis.ping(), 800);
                        redisStatus = "ok";
                        queueStats = await withTimeout(getQueueStats(), 800);
                    } catch (error) {
                        redisStatus = "error";
                        console.error("[Health] Redis check failed", error);
                    }
                }

                const statusCode = db === "ok" && readiness.ready ? 200 : 503;

                return new Response(JSON.stringify({ 
                    status: statusCode === 200 ? "ok" : "degraded",
                    uptime: process.uptime(),
                    db,
                    redis: redisStatus,
                    queue: queueStats,
                    platforms: readiness.platforms,
                    failingPlatforms: readiness.failing,
                }), {
                    status: statusCode,
                    headers: { "Content-Type": "application/json" }
                });
            }

    return new Response("Not Found", { status: 404 });
}

export async function startSurfacesWorker() {
    const startConnectorSafely = async (
        name: PlatformName,
        starter: () => void | Promise<void>
    ): Promise<void> => {
        try {
            await Promise.resolve(starter());
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setPlatformError(name, message);
            console.error(`[Surfaces] ${name} startup failed`, { error: message });
        }
    };

    process.on("unhandledRejection", (reason) => {
        console.error("[Surfaces] Unhandled promise rejection", { reason });
    });
    process.on("uncaughtException", (error) => {
        console.error("[Surfaces] Uncaught exception", { error });
    });

    const port = env.SURFACES_WORKER_PORT;
    console.log("[Surfaces] Boot config", {
        nodeEnv: process.env.NODE_ENV ?? "unknown",
        portFromEnv: process.env.SURFACES_WORKER_PORT ?? String(env.SURFACES_WORKER_PORT),
        resolvedPort: port,
    });
    const server = startHttpServer(port);

    console.log(`🔔 HTTP Server listening on port ${port}`);
    console.log("   - POST /notify - Send notifications to platforms");
    console.log("   - POST /onboarding/linked - Notify a user their surfaces worker account is linked");
    console.log("   - GET  /jobs/status - Get job queue status");
    console.log("   - POST /jobs/embeddings - Trigger embedding processing");
    console.log("   - POST /jobs/decay - Trigger memory decay");
    console.log("   - POST /jobs/recording - Trigger memory recording");
    console.log("   - GET  /health - Health check");

    startBrainIngressWorker();

    // Start platform connectors in the background so health checks don't depend on Slack socket startup.
    void Promise.all([
        startConnectorSafely("slack", startSlack),
        startConnectorSafely("discord", startDiscord),
        startConnectorSafely("telegram", startTelegram),
    ]).then(() => {
        console.log("🚀 Surfaces connectors initialized");
    });

    // Start background job scheduler without blocking HTTP startup.
    let scheduler:
        | ReturnType<typeof startScheduler>
        | undefined;
    try {
        scheduler = startScheduler();
    } catch (error) {
        console.error("[Surfaces] Failed to start scheduler", { error });
    }

    console.log("🚀 Surfaces worker fully initialized");
    const shutdown = async (signal: string) => {
        console.log(`[Surfaces] Received ${signal}. Shutting down...`);
        try {
            await server.stop();
        } catch (error) {
            console.error("[Surfaces] Error stopping HTTP server", error);
        }

        try {
            await stopBrainIngressWorker();
        } catch (error) {
            console.error("[Surfaces] Error stopping transport worker", error);
        }

        try {
            await stopSlack();
        } catch (error) {
            console.error("[Surfaces] Error stopping Slack connector", error);
        }

        try {
            scheduler?.embeddingJob?.stop?.();
            scheduler?.decayJob?.stop?.();
            scheduler?.recordingBackupJob?.stop?.();
            scheduler?.proactiveAttentionJob?.stop?.();
        } catch (error) {
            console.error("[Surfaces] Error stopping scheduler", error);
        }

        try {
            await prisma.$disconnect();
        } catch (error) {
            console.error("[Surfaces] Error disconnecting Prisma", error);
        }

        try {
            await redis?.quit();
        } catch (error) {
            console.error("[Surfaces] Error disconnecting Redis", error);
        }

        process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}
