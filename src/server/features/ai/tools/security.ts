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

const TOOL_ALLOWED_RESOURCES: Record<string, string[]> = {
    query: ["email", "calendar", "task", "approval", "notification", "draft", "conversation", "preferences", "contacts"],
    get: ["email", "calendar", "draft", "approval", "task", "automation"],
    create: ["email", "calendar", "task", "notification", "contacts", "category", "automation", "knowledge", "drive"],
    modify: ["email", "calendar", "preferences", "approval", "draft", "task", "automation", "drive"],
    delete: ["email", "calendar", "draft", "task", "automation", "knowledge", "drive"],
    analyze: ["email", "calendar", "patterns", "automation"],
};

const QUARANTINED_TOOL_RESOURCES = new Set([
    "drive",
    "automation",
    "knowledge",
    "patterns",
    "report",
]);

const RESOURCE_QUARANTINE_ENV = "AMODEL_ENABLE_QUARANTINED_RESOURCES";

const RATE_LIMITS = {
    queriesPerMinute: 30,
    modificationsPerMinute: 20,
    deletesPerMinute: 10,
    createsPerMinute: 10,
    dangerousPerMinute: 5,
};

// Fallback in-memory rate limiter (dev/test only)
const rateLimitCache: Record<string, { count: number; windowStart: number }> = {};

export async function checkPermissions(userId: string, toolName: string, params: unknown): Promise<void> {
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

    const allowQuarantinedResources = process.env[RESOURCE_QUARANTINE_ENV] === "true";
    const allowedResources = TOOL_ALLOWED_RESOURCES[toolName];
    const input = params && typeof params === "object" ? (params as Record<string, unknown>) : {};

    const validateResource = (resource: unknown, context: string) => {
        if (typeof resource !== "string" || resource.length === 0) {
            throw new Error(`Missing resource for ${context}.`);
        }
        if (Array.isArray(allowedResources) && !allowedResources.includes(resource)) {
            throw new Error(`Resource '${resource}' is not allowed for tool '${toolName}'.`);
        }
        if (!allowQuarantinedResources && QUARANTINED_TOOL_RESOURCES.has(resource)) {
            throw new Error(
                `Resource '${resource}' is currently quarantined for reliability hardening. ` +
                `Set ${RESOURCE_QUARANTINE_ENV}=true to re-enable.`,
            );
        }
    };

    if (toolName === "workflow") {
        const steps = Array.isArray(input.steps) ? input.steps : [];
        if (steps.length === 0) {
            throw new Error("Workflow requires at least one step.");
        }
        for (let i = 0; i < steps.length; i++) {
            validateResource(steps[i]?.resource, `workflow step ${i}`);
        }
        return;
    }

    if (toolName === "rules" || toolName === "triage" || toolName === "send") {
        // These tools don't use a resource discriminant in their public schema.
        return;
    }

    validateResource(input.resource, toolName);
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

export function applyScopeLimits<T extends Record<string, unknown>>(toolName: string, params: T): T {
    const limited = { ...params } as T & {
        filter?: { limit?: number };
        ids?: unknown[];
        data?: { body?: unknown };
    };

    if (toolName === "query" && limited.filter && limited.filter.limit) {
        limited.filter.limit = Math.min(limited.filter.limit, LIMITS.maxItemsPerQuery);
    }

    if ((toolName === "modify" || toolName === "create") && limited.ids && limited.ids.length > LIMITS.maxItemsPerModify) {
        throw new Error(`Too many items. Max limit is ${LIMITS.maxItemsPerModify}.`);
    }

    if (toolName === "delete" && limited.ids && limited.ids.length > LIMITS.maxItemsPerDelete) {
        throw new Error(`Too many items. Max limit is ${LIMITS.maxItemsPerDelete}.`);
    }

    if (toolName === "get" && limited.ids && limited.ids.length > LIMITS.maxIdsPerGet) {
        throw new Error(`Too many IDs. Max limit is ${LIMITS.maxIdsPerGet}.`);
    }

    if (toolName === "create" && typeof limited?.data?.body === "string" && limited.data.body.length > LIMITS.maxBodyLength) {
        throw new Error(`Body exceeds max length (${LIMITS.maxBodyLength}).`);
    }

    return limited as T;
}
