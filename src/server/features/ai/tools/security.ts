import { type ToolContext } from "./types";
import { env } from "@/env";
import { redis } from "@/server/lib/redis";

export type SecurityLevel = "SAFE" | "CAUTION" | "DANGEROUS";

export const PERMISSIONS = {
    SAFE: ["query", "get", "analyze", "triage"],
    CAUTION: ["modify", "delete", "create", "rules", "workflow"],
    DANGEROUS: ["send"],
};

export const LIMITS = {
    maxItemsPerQuery: 50,
    maxItemsPerModify: 50,
    maxItemsPerDelete: 50,
    maxIdsPerGet: 10,
    maxBodyLength: 10000,
};

const RATE_LIMITS = {
    queriesPerMinute: 30,
    modificationsPerMinute: 20,
    deletesPerMinute: 10,
    createsPerMinute: 10,
    dangerousPerMinute: 5,
};

// Fallback in-memory rate limiter (dev/test only)
const rateLimitCache: Record<string, { count: number; windowStart: number }> = {};

export async function checkPermissions(userId: string, toolName: string, params: any): Promise<void> {
    // In a real app, we would check user roles/permissions from DB.
    // Here we enforce tool-name sanity and rely on approvals/policy layers for
    // context-aware gating of dangerous actions.
    const knownToolNames = new Set([
        ...PERMISSIONS.SAFE,
        ...PERMISSIONS.CAUTION,
        ...PERMISSIONS.DANGEROUS,
    ]);
    if (!knownToolNames.has(toolName)) {
        throw new Error(`Unknown tool '${toolName}' is not allowed.`);
    }
}

export async function checkRateLimit(userId: string, toolName: string): Promise<void> {
    const now = Date.now();
    const key = `${userId}:${toolName}`;
    const windowSize = 60 * 1000; // 1 minute

    let limit = 100; // Default fallback
    if (PERMISSIONS.SAFE.includes(toolName)) limit = RATE_LIMITS.queriesPerMinute;
    if (PERMISSIONS.CAUTION.includes(toolName)) limit = RATE_LIMITS.modificationsPerMinute;
    if (PERMISSIONS.DANGEROUS.includes(toolName)) limit = RATE_LIMITS.dangerousPerMinute;

    if (env.UPSTASH_REDIS_URL && env.UPSTASH_REDIS_TOKEN) {
        const redisKey = `ratelimit:${key}`;
        const count = await redis.incr(redisKey);
        if (count === 1) {
            await redis.expire(redisKey, Math.ceil(windowSize / 1000));
        }
        if (count > limit) {
            throw new Error(`Rate limit exceeded for tool '${toolName}'. Please try again later.`);
        }
        return;
    }

    if (env.NODE_ENV === "production") {
        throw new Error("Upstash Redis is required for rate limiting in production.");
    }

    if (!rateLimitCache[key] || now - rateLimitCache[key].windowStart > windowSize) {
        rateLimitCache[key] = { count: 1, windowStart: now };
    } else {
        rateLimitCache[key].count++;
        if (rateLimitCache[key].count > limit) {
            throw new Error(`Rate limit exceeded for tool '${toolName}'. Please try again later.`);
        }
    }
}

export function applyScopeLimits(params: any): any {
    const limited = { ...params };

    if (limited.filter && limited.filter.limit) {
        limited.filter.limit = Math.min(limited.filter.limit, LIMITS.maxItemsPerQuery);
    }

    if (limited.ids && limited.ids.length > LIMITS.maxItemsPerModify) {
        // Could throw or slice, throwing is safer to avoid partial operations unexpectedly
        throw new Error(`Too many items. Max limit is ${LIMITS.maxItemsPerModify}.`);
    }

    return limited;
}
