import { config } from "dotenv";
import { timingSafeEqual } from "node:crypto";
import { startSlack, stopSlack } from "./slack";
import { startDiscord } from "./discord";
import { startTelegram } from "./telegram";
import { startScheduler, triggerEmbeddingJob, triggerDecayJob } from "./jobs/scheduler";
import { getQueueStats } from "./jobs/embedding-worker";
import { getDecayStats } from "./jobs/decay-worker";
import { processMemoryRecording } from "./jobs/recording-worker";
import { env } from "./env";
import { prisma } from "./db/prisma";
import { redis } from "./db/redis";
import { getPlatformStatuses, setPlatformError, type PlatformName } from "./platform-status";

config();

export async function handleRequest(req: Request) {
    const url = new URL(req.url);

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
            const { platform, channelId, threadId, content } = body;

            if (!platform || !channelId || !content) {
                return new Response("Missing required fields", { status: 400 });
            }

            if (platform === "slack") {
                const { sendSlackMessage } = await import("./slack");
                await sendSlackMessage(channelId, content, undefined, threadId);
                return new Response("Notification sent to Slack", { status: 200 });
            }

            if (platform === "discord") {
                const { sendDiscordMessage } = await import("./discord");
                await sendDiscordMessage(channelId, content);
                return new Response("Notification sent to Discord", { status: 200 });
            }

            return new Response("Unsupported platform", { status: 400 });

        } catch (err) {
            console.error("Failed to process notification", err);
            return new Response("Internal Server Error", { status: 500 });
        }
    }

    // Send onboarding welcome to a user (e.g. Slack DM)
    if (req.method === "POST" && url.pathname === "/send-welcome") {
        try {
            if (!isAuthorized(env.SURFACES_SHARED_SECRET)) {
                return new Response("Unauthorized", { status: 401 });
            }
            const body = (await req.json()) as { platform?: string; slackUserId?: string };
            const { platform, slackUserId } = body;
            if (platform !== "slack" || !slackUserId) {
                return new Response(
                    JSON.stringify({ ok: false, error: "Requires platform: 'slack' and slackUserId" }),
                    { status: 400, headers: { "Content-Type": "application/json" } }
                );
            }
            const { sendWelcomeToSlackUser } = await import("./slack");
            const result = await sendWelcomeToSlackUser(slackUserId);
            if (!result.ok) {
                return new Response(JSON.stringify(result), {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                });
            }
            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        } catch (err) {
            console.error("Failed to send welcome", err);
            return new Response(
                JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
                { status: 500, headers: { "Content-Type": "application/json" } }
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

            // Liveness health check (for Railway healthcheck)
            if (
                req.method === "GET" &&
                (url.pathname === "/health" || url.pathname === "/health/liveness")
            ) {
                return new Response(JSON.stringify({
                    status: "ok",
                    uptime: process.uptime(),
                    platforms: getPlatformStatuses(),
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
                const platforms = getPlatformStatuses();

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

                const statusCode = db === "ok" ? 200 : 503;

                return new Response(JSON.stringify({ 
                    status: statusCode === 200 ? "ok" : "degraded",
                    uptime: process.uptime(),
                    db,
                    redis: redisStatus,
                    queue: queueStats,
                    platforms
                }), {
                    status: statusCode,
                    headers: { "Content-Type": "application/json" }
                });
            }

    return new Response("Not Found", { status: 404 });
}

export async function startSidecar() {
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

    const bunRuntime = (globalThis as {
        Bun?: {
            serve: (options: {
                hostname?: string;
                port: number;
                fetch: typeof handleRequest;
            }) => { stop: () => void };
        };
    }).Bun;
    if (!bunRuntime) {
        throw new Error("Bun runtime not available");
    }

    const resolvedPort = Number.parseInt(process.env.PORT ?? "3000", 10);
    const port = Number.isFinite(resolvedPort) ? resolvedPort : 3000;
    console.log("[Surfaces] Boot config", {
        nodeEnv: process.env.NODE_ENV ?? "unknown",
        portFromEnv: process.env.PORT ?? null,
        resolvedPort: port,
    });
    const server = bunRuntime.serve({
        hostname: "0.0.0.0",
        port,
        fetch: handleRequest,
    });

    console.log(`🔔 HTTP Server listening on port ${port}`);
    console.log("   - POST /notify - Send notifications to platforms");
    console.log("   - POST /send-welcome - Send onboarding welcome to a user (e.g. Slack)");
    console.log("   - GET  /jobs/status - Get job queue status");
    console.log("   - POST /jobs/embeddings - Trigger embedding processing");
    console.log("   - POST /jobs/decay - Trigger memory decay");
    console.log("   - POST /jobs/recording - Trigger memory recording");
    console.log("   - GET  /health - Health check");

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

    console.log("🚀 Surfaces Sidecar fully initialized");
    const shutdown = async (signal: string) => {
        console.log(`[Surfaces] Received ${signal}. Shutting down...`);
        try {
            server.stop();
        } catch (error) {
            console.error("[Surfaces] Error stopping HTTP server", error);
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

if (process.env.NODE_ENV !== "test") {
    void startSidecar();
}
