import { createHash, randomUUID } from "node:crypto";
import { redis } from "../db/redis";
import { env } from "../env";

type Provider = "slack" | "discord" | "telegram";

type ForwardParams = {
    provider: Provider;
    content: string;
    context: Record<string, unknown>;
};

type QueueEnvelope = ForwardParams & {
    requestId: string;
    idempotencyKey: string;
    attempts: number;
    enqueuedAt: string;
};

type QueueResult = {
    ok: boolean;
    response?: unknown;
    error?: string;
};

type StreamEntry = {
    id: string;
    fields: Record<string, string>;
};

const BRAIN_API_URL = env.BRAIN_API_URL;
const CORE_BASE_URL = env.CORE_BASE_URL;
const SHARED_SECRET = env.SURFACES_SHARED_SECRET;

const CORE_HTTP_TIMEOUT_MS = Math.max(1_000, Number(process.env.SURFACES_BRAIN_TIMEOUT_MS || 20_000));
const CORE_HTTP_MAX_ATTEMPTS = Math.max(
    1,
    Number(process.env.SURFACES_BRAIN_HTTP_MAX_ATTEMPTS || process.env.SURFACES_BRAIN_MAX_ATTEMPTS || 2),
);
const CORE_HTTP_RETRY_BASE_MS = Math.max(100, Number(process.env.SURFACES_BRAIN_RETRY_BASE_MS || 500));

const TRANSPORT_QUEUE_ENABLED = process.env.SURFACES_TRANSPORT_QUEUE_ENABLED === "true";
const TRANSPORT_STREAM_KEY = process.env.SURFACES_TRANSPORT_STREAM_KEY || "surfaces:brain:inbound";
const TRANSPORT_DLQ_STREAM_KEY = process.env.SURFACES_TRANSPORT_DLQ_STREAM_KEY || "surfaces:brain:inbound:dlq";
const TRANSPORT_CONSUMER_GROUP = process.env.SURFACES_TRANSPORT_CONSUMER_GROUP || "surfaces-brain-workers";
const TRANSPORT_CONSUMER_NAME =
    process.env.SURFACES_TRANSPORT_CONSUMER_NAME || `${process.pid}-${randomUUID().slice(0, 8)}`;
const TRANSPORT_MAX_ATTEMPTS = Math.max(1, Number(process.env.SURFACES_TRANSPORT_MAX_ATTEMPTS || 5));
const TRANSPORT_WAIT_TIMEOUT_MS = Math.max(1_000, Number(process.env.SURFACES_TRANSPORT_WAIT_TIMEOUT_MS || 45_000));
const TRANSPORT_POLL_INTERVAL_MS = Math.max(50, Number(process.env.SURFACES_TRANSPORT_POLL_INTERVAL_MS || 150));
const TRANSPORT_RESULT_TTL_MS = Math.max(5_000, Number(process.env.SURFACES_TRANSPORT_RESULT_TTL_MS || 120_000));
const TRANSPORT_CLAIM_IDLE_MS = Math.max(5_000, Number(process.env.SURFACES_TRANSPORT_CLAIM_IDLE_MS || 30_000));

let workerRunning = false;
let workerLoopPromise: Promise<void> | null = null;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryHttpStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

function httpBackoffDelayMs(attempt: number): number {
    const exponential = CORE_HTTP_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1));
    return Math.min(5_000, exponential);
}

function queueBackoffDelayMs(attempt: number): number {
    const base = Number(process.env.SURFACES_TRANSPORT_RETRY_BASE_MS || 1_000);
    const exponential = Math.max(100, base) * Math.pow(2, Math.max(0, attempt - 1));
    return Math.min(30_000, exponential);
}

function candidateBrainUrls(): string[] {
    const fallback = `${CORE_BASE_URL}/api/surfaces/inbound`;
    if (BRAIN_API_URL === fallback) return [BRAIN_API_URL];
    return [BRAIN_API_URL, fallback];
}

function canUseDurableQueue(): boolean {
    return TRANSPORT_QUEUE_ENABLED && Boolean(redis);
}

function resultKeyForRequest(requestId: string): string {
    return `surfaces:brain:result:${requestId}`;
}

function computeIdempotencyKey(params: ForwardParams): string {
    const workspaceId = typeof params.context.workspaceId === "string" ? params.context.workspaceId : "";
    const channelId = typeof params.context.channelId === "string" ? params.context.channelId : "";
    const userId = typeof params.context.userId === "string" ? params.context.userId : "";
    const messageId = typeof params.context.messageId === "string" ? params.context.messageId : "";
    const canonical = [
        "surfaces-inbound",
        params.provider,
        workspaceId,
        channelId,
        userId,
        messageId,
    ].join("|");
    return createHash("sha256").update(canonical).digest("hex");
}

function parseFieldPairs(raw: unknown): Record<string, string> {
    const record: Record<string, string> = {};
    if (!Array.isArray(raw)) return record;

    for (let i = 0; i < raw.length; i += 2) {
        const key = raw[i];
        const value = raw[i + 1];
        if (typeof key !== "string" || typeof value !== "string") continue;
        record[key] = value;
    }

    return record;
}

function parseXReadEntries(raw: unknown): StreamEntry[] {
    if (!Array.isArray(raw)) return [];
    const entries: StreamEntry[] = [];

    for (const streamItem of raw) {
        if (!Array.isArray(streamItem) || streamItem.length < 2) continue;
        const streamEntries = streamItem[1];
        if (!Array.isArray(streamEntries)) continue;

        for (const entry of streamEntries) {
            if (!Array.isArray(entry) || entry.length < 2) continue;
            const id = entry[0];
            if (typeof id !== "string") continue;
            const fields = parseFieldPairs(entry[1]);
            entries.push({ id, fields });
        }
    }

    return entries;
}

function parseXAutoClaimEntries(raw: unknown): StreamEntry[] {
    if (!Array.isArray(raw) || raw.length < 2) return [];
    const claimedEntries = raw[1];
    if (!Array.isArray(claimedEntries)) return [];

    const entries: StreamEntry[] = [];
    for (const entry of claimedEntries) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const id = entry[0];
        if (typeof id !== "string") continue;
        const fields = parseFieldPairs(entry[1]);
        entries.push({ id, fields });
    }
    return entries;
}

async function ensureConsumerGroup(): Promise<void> {
    if (!redis) return;

    try {
        await redis.xgroup("CREATE", TRANSPORT_STREAM_KEY, TRANSPORT_CONSUMER_GROUP, "$", "MKSTREAM");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("BUSYGROUP")) {
            throw error;
        }
    }
}

async function requestCoreOnce(params: ForwardParams, idempotencyKey: string): Promise<{ ok: boolean; response?: unknown; error?: string }> {
    const urls = candidateBrainUrls();

    for (const url of urls) {
        for (let attempt = 1; attempt <= CORE_HTTP_MAX_ATTEMPTS; attempt++) {
            const startedAt = Date.now();
            const controller = new AbortController();
            const timeoutHandle = setTimeout(() => controller.abort(), CORE_HTTP_TIMEOUT_MS);

            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${SHARED_SECRET}`,
                        "x-surfaces-secret": SHARED_SECRET,
                        "idempotency-key": idempotencyKey,
                        "x-idempotency-key": idempotencyKey,
                    },
                    body: JSON.stringify(params),
                    signal: controller.signal,
                });

                const latencyMs = Date.now() - startedAt;
                if (!response.ok) {
                    const bodyText = await response.text().catch(() => "");
                    console.error("[Surfaces][Transport] Core HTTP error", {
                        url,
                        attempt,
                        maxAttempts: CORE_HTTP_MAX_ATTEMPTS,
                        status: response.status,
                        statusText: response.statusText,
                        latencyMs,
                        bodyPreview: bodyText.slice(0, 500),
                    });

                    if (!shouldRetryHttpStatus(response.status) || attempt >= CORE_HTTP_MAX_ATTEMPTS) {
                        break;
                    }
                    await sleep(httpBackoffDelayMs(attempt));
                    continue;
                }

                const json = await response.json();
                return { ok: true, response: json };
            } catch (error) {
                const aborted = error instanceof Error && error.name === "AbortError";
                const message = error instanceof Error ? error.message : String(error);
                console.error("[Surfaces][Transport] Core request failed", {
                    url,
                    attempt,
                    maxAttempts: CORE_HTTP_MAX_ATTEMPTS,
                    aborted,
                    error: message,
                });

                if (attempt >= CORE_HTTP_MAX_ATTEMPTS) break;
                await sleep(httpBackoffDelayMs(attempt));
            } finally {
                clearTimeout(timeoutHandle);
            }
        }
    }

    return {
        ok: false,
        error: "Unable to reach core surfaces inbound endpoint",
    };
}

async function writeQueueResult(requestId: string, result: QueueResult): Promise<void> {
    if (!redis) return;
    const key = resultKeyForRequest(requestId);
    await redis.set(key, JSON.stringify(result), "PX", TRANSPORT_RESULT_TTL_MS);
}

async function enqueueEnvelope(envelope: QueueEnvelope): Promise<void> {
    if (!redis) {
        throw new Error("Redis not available for queue enqueue");
    }

    await redis.xadd(
        TRANSPORT_STREAM_KEY,
        "*",
        "payload",
        JSON.stringify(envelope),
    );
}

async function moveEnvelopeToDlq(envelope: QueueEnvelope, failureReason: string): Promise<void> {
    if (!redis) {
        throw new Error("Redis not available for DLQ enqueue");
    }

    const payload = {
        ...envelope,
        failureReason,
        failedAt: new Date().toISOString(),
    };

    await redis.xadd(
        TRANSPORT_DLQ_STREAM_KEY,
        "*",
        "payload",
        JSON.stringify(payload),
    );
}

async function processEnvelopeFromStream(entryId: string, envelope: QueueEnvelope): Promise<void> {
    if (!redis) return;

    const result = await requestCoreOnce(
        {
            provider: envelope.provider,
            content: envelope.content,
            context: envelope.context,
        },
        envelope.idempotencyKey,
    );

    if (result.ok) {
        await writeQueueResult(envelope.requestId, {
            ok: true,
            response: result.response,
        });
        await redis.xack(TRANSPORT_STREAM_KEY, TRANSPORT_CONSUMER_GROUP, entryId);
        return;
    }

    const nextAttempt = envelope.attempts + 1;
    if (nextAttempt <= TRANSPORT_MAX_ATTEMPTS) {
        const nextEnvelope: QueueEnvelope = {
            ...envelope,
            attempts: nextAttempt,
        };
        await sleep(queueBackoffDelayMs(envelope.attempts));
        await enqueueEnvelope(nextEnvelope);
        await redis.xack(TRANSPORT_STREAM_KEY, TRANSPORT_CONSUMER_GROUP, entryId);
        return;
    }

    await moveEnvelopeToDlq(envelope, result.error || "Unknown transport error");
    await writeQueueResult(envelope.requestId, {
        ok: false,
        error: result.error || "Message moved to DLQ",
    });
    await redis.xack(TRANSPORT_STREAM_KEY, TRANSPORT_CONSUMER_GROUP, entryId);
}

async function processStreamEntry(entry: StreamEntry): Promise<void> {
    if (!redis) return;

    const rawPayload = entry.fields.payload;
    if (!rawPayload) {
        await redis.xack(TRANSPORT_STREAM_KEY, TRANSPORT_CONSUMER_GROUP, entry.id);
        return;
    }

    try {
        const envelope = JSON.parse(rawPayload) as QueueEnvelope;
        if (!envelope.requestId || !envelope.idempotencyKey) {
            throw new Error("Queue envelope missing requestId/idempotencyKey");
        }
        await processEnvelopeFromStream(entry.id, envelope);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[Surfaces][Transport] Invalid queue payload", {
            entryId: entry.id,
            error: message,
        });
        await redis.xack(TRANSPORT_STREAM_KEY, TRANSPORT_CONSUMER_GROUP, entry.id);
    }
}

async function reclaimPendingEntries(): Promise<void> {
    if (!redis) return;

    try {
        const claimedRaw = await redis.xautoclaim(
            TRANSPORT_STREAM_KEY,
            TRANSPORT_CONSUMER_GROUP,
            TRANSPORT_CONSUMER_NAME,
            TRANSPORT_CLAIM_IDLE_MS,
            "0-0",
            "COUNT",
            25,
        );

        const claimedEntries = parseXAutoClaimEntries(claimedRaw);
        for (const entry of claimedEntries) {
            await processStreamEntry(entry);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[Surfaces][Transport] Failed to reclaim pending queue entries", {
            error: message,
        });
    }
}

async function runWorkerLoop(): Promise<void> {
    if (!redis) return;

    await ensureConsumerGroup();
    console.log("[Surfaces][Transport] Durable ingress worker started", {
        stream: TRANSPORT_STREAM_KEY,
        group: TRANSPORT_CONSUMER_GROUP,
        consumer: TRANSPORT_CONSUMER_NAME,
    });

    while (workerRunning) {
        await reclaimPendingEntries();

        let entries: StreamEntry[] = [];
        try {
            const readRaw = await redis.xreadgroup(
                "GROUP",
                TRANSPORT_CONSUMER_GROUP,
                TRANSPORT_CONSUMER_NAME,
                "COUNT",
                25,
                "BLOCK",
                5_000,
                "STREAMS",
                TRANSPORT_STREAM_KEY,
                ">",
            );
            entries = parseXReadEntries(readRaw);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[Surfaces][Transport] Queue read failed", { error: message });
            await sleep(500);
            continue;
        }

        for (const entry of entries) {
            await processStreamEntry(entry);
        }
    }

    console.log("[Surfaces][Transport] Durable ingress worker stopped");
}

function ensureWorkerStarted(): void {
    if (!canUseDurableQueue()) return;
    if (workerLoopPromise) return;

    workerRunning = true;
    workerLoopPromise = runWorkerLoop()
        .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[Surfaces][Transport] Worker crashed", { error: message });
        })
        .finally(() => {
            workerRunning = false;
            workerLoopPromise = null;
        });
}

async function waitForQueueResult(requestId: string): Promise<QueueResult | null> {
    if (!redis) return null;

    const key = resultKeyForRequest(requestId);
    const startedAt = Date.now();

    while (Date.now() - startedAt < TRANSPORT_WAIT_TIMEOUT_MS) {
        const raw = await redis.get(key);
        if (typeof raw === "string") {
            await redis.del(key);
            try {
                const parsed = JSON.parse(raw) as QueueResult;
                return parsed;
            } catch {
                return { ok: false, error: "Invalid queue result payload" };
            }
        }
        await sleep(TRANSPORT_POLL_INTERVAL_MS);
    }

    return null;
}

async function forwardToBrainViaQueue(params: ForwardParams): Promise<unknown | null> {
    if (!redis) return null;

    ensureWorkerStarted();

    const requestId = randomUUID();
    const envelope: QueueEnvelope = {
        ...params,
        requestId,
        idempotencyKey: computeIdempotencyKey(params),
        attempts: 1,
        enqueuedAt: new Date().toISOString(),
    };

    try {
        await enqueueEnvelope(envelope);
    } catch (error) {
        console.error("[Surfaces][Transport] Failed to enqueue inbound message", {
            requestId,
            provider: params.provider,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }

    const result = await waitForQueueResult(requestId);
    if (!result) {
        console.error("[Surfaces][Transport] Queue wait timed out", {
            requestId,
            provider: params.provider,
            timeoutMs: TRANSPORT_WAIT_TIMEOUT_MS,
        });
        return null;
    }

    if (!result.ok) {
        console.error("[Surfaces][Transport] Queue processing failed", {
            requestId,
            provider: params.provider,
            error: result.error || "unknown_error",
        });
        return null;
    }

    return result.response ?? null;
}

async function forwardToBrainDirect(params: ForwardParams): Promise<unknown | null> {
    const idempotencyKey = computeIdempotencyKey(params);
    const result = await requestCoreOnce(params, idempotencyKey);
    if (!result.ok) return null;
    return result.response ?? null;
}

export function startBrainIngressWorker(): void {
    ensureWorkerStarted();
}

export async function stopBrainIngressWorker(): Promise<void> {
    workerRunning = false;
    const loop = workerLoopPromise;
    if (!loop) return;
    await Promise.race([
        loop,
        sleep(6_000),
    ]);
}

export async function forwardToBrainWithTransport(params: ForwardParams): Promise<unknown | null> {
    if (canUseDurableQueue()) {
        const queuedResult = await forwardToBrainViaQueue(params);
        if (queuedResult) return queuedResult;
        // Fall back to direct mode if queue path failed to avoid dropping responses.
        return await forwardToBrainDirect(params);
    }

    return await forwardToBrainDirect(params);
}
