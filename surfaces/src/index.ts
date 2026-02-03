import { config } from "dotenv";
import { timingSafeEqual } from "node:crypto";
import { startSlack } from "./slack";
import { startDiscord } from "./discord";
import { startTelegram } from "./telegram";
import { startScheduler, triggerEmbeddingJob, triggerDecayJob } from "./jobs/scheduler";
import { getQueueStats } from "./jobs/embedding-worker";
import { getDecayStats } from "./jobs/decay-worker";
import { processMemoryRecording } from "./jobs/recording-worker";
import { env } from "./env";
import { prisma } from "./db/prisma";
import { redis } from "./db/redis";

config();

(async () => {
    // Start platform connectors
    startSlack();
    startDiscord();
    startTelegram();

    // Start background job scheduler
    const scheduler = startScheduler();

    console.log("🚀 Surfaces Sidecar fully initialized");

    // @ts-ignore
    const Bun = globalThis.Bun;

    // HTTP Server for Push Notifications and Job Management
    const server = Bun.serve({
        port: 3001,
        async fetch(req: Request) {
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

            // Push notifications to platforms
            if (req.method === "POST" && url.pathname === "/notify") {
                try {
                    if (!isAuthorized(env.SURFACES_SHARED_SECRET)) {
                        return new Response("Unauthorized", { status: 401 });
                    }

                    const body = await req.json();
                    const { platform, channelId, content } = body;

                    if (!platform || !channelId || !content) {
                        return new Response("Missing required fields", { status: 400 });
                    }

                    if (platform === "slack") {
                        const { sendSlackMessage } = await import("./slack");
                        await sendSlackMessage(channelId, content);
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

            // Health check
            if (req.method === "GET" && url.pathname === "/health") {
                let db = "ok";
                let redisStatus = "not_configured";
                let queueStats: { pending: number; processing: number; failed: number } | null = null;

                try {
                    await prisma.$queryRaw`SELECT 1`;
                } catch (error) {
                    db = "error";
                    console.error("[Health] Database check failed", error);
                }

                if (redis) {
                    try {
                        await redis.ping();
                        redisStatus = "ok";
                        queueStats = await getQueueStats();
                    } catch (error) {
                        redisStatus = "error";
                        console.error("[Health] Redis check failed", error);
                    }
                }

                return new Response(JSON.stringify({ 
                    status: "ok",
                    uptime: process.uptime(),
                    db,
                    redis: redisStatus,
                    queue: queueStats
                }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                });
            }

            return new Response("Not Found", { status: 404 });
        }
    });

    console.log("🔔 HTTP Server listening on port 3001");
    console.log("   - POST /notify - Send notifications to platforms");
    console.log("   - GET  /jobs/status - Get job queue status");
    console.log("   - POST /jobs/embeddings - Trigger embedding processing");
    console.log("   - POST /jobs/decay - Trigger memory decay");
    console.log("   - POST /jobs/recording - Trigger memory recording");
    console.log("   - GET  /health - Health check");
    const shutdown = async (signal: string) => {
        console.log(`[Surfaces] Received ${signal}. Shutting down...`);
        try {
            server.stop();
        } catch (error) {
            console.error("[Surfaces] Error stopping HTTP server", error);
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
})();
