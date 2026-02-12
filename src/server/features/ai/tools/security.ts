import { env } from "@/env";
import prisma from "@/server/db/client";
import { redis } from "@/server/lib/redis";

export type SecurityLevel = "SAFE" | "CAUTION" | "DANGEROUS";

export const PERMISSIONS = {
    SAFE: ["query", "get", "analyze", "triage"],
    CAUTION: ["modify", "delete", "create", "rules", "workflow"],
    DANGEROUS: ["send"],
};

export const LIMITS = {
    maxItemsPerQuery: 100,
    maxItemsPerModify: 50,
    maxItemsPerDelete: 50,
    maxIdsPerGet: 10,
    maxBodyLength: 10000,
};

const TOOL_ALLOWED_RESOURCES: Record<string, string[]> = {
    query: ["email", "calendar", "task", "approval", "notification", "draft", "conversation", "preferences", "contacts"],
    get: ["email", "calendar", "draft", "approval", "task", "automation"],
    create: ["email", "calendar", "task", "notification", "contacts", "category", "automation", "knowledge"],
    modify: ["email", "calendar", "preferences", "approval", "draft", "task", "automation"],
    delete: ["email", "calendar", "draft", "task", "automation", "knowledge"],
    analyze: ["email", "calendar", "patterns", "automation"],
};

const QUERY_RESOURCE_LIMITS: Record<string, number> = {
    email: 100,
    calendar: 100,
    task: 100,
    approval: 50,
    notification: 100,
    draft: 100,
    conversation: 100,
    preferences: 5,
    contacts: 100,
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

type PermissionContext = {
    emailAccountId?: string;
};

type ParamsRecord = Record<string, unknown>;

const knownToolNames = new Set([
    ...PERMISSIONS.SAFE,
    ...PERMISSIONS.CAUTION,
    ...PERMISSIONS.DANGEROUS,
]);

function asRecord(input: unknown): ParamsRecord {
    return input && typeof input === "object" ? (input as ParamsRecord) : {};
}

function toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function resolveResourceFromParams(input: ParamsRecord): string | undefined {
    return typeof input.resource === "string" && input.resource.length > 0
        ? input.resource
        : undefined;
}

function extractIdsForOwnership(input: ParamsRecord): string[] {
    const ids = toStringArray(input.ids);
    const directId = typeof input.id === "string" && input.id.length > 0 ? [input.id] : [];
    const filter = asRecord(input.filter);
    const filterId = typeof filter.id === "string" && filter.id.length > 0 ? [filter.id] : [];
    return [...new Set([...ids, ...directId, ...filterId])];
}

function ensureResourceAllowedForTool({
    toolName,
    resource,
    context,
}: {
    toolName: string;
    resource: string;
    context: string;
}): void {
    const allowedResources = TOOL_ALLOWED_RESOURCES[toolName];
    if (Array.isArray(allowedResources) && !allowedResources.includes(resource)) {
        throw new Error(`Resource '${resource}' is not allowed for tool '${toolName}'.`);
    }
    if (resource.length === 0) {
        throw new Error(`Missing resource for ${context}.`);
    }
}

async function assertEmailAccountOwnership(userId: string, emailAccountId?: string): Promise<void> {
    if (!emailAccountId) return;
    const ownedAccount = await prisma.emailAccount.findFirst({
        where: { id: emailAccountId, userId },
        select: { id: true },
    });
    if (!ownedAccount) {
        throw new Error("Forbidden: email account does not belong to user.");
    }
}

async function assertOwnedIds({
    ids,
    fetchOwnedIds,
    resource,
}: {
    ids: string[];
    fetchOwnedIds: () => Promise<string[]>;
    resource: string;
}): Promise<void> {
    if (ids.length === 0) return;
    const ownedIds = new Set(await fetchOwnedIds());
    const missing = ids.filter((id) => !ownedIds.has(id));
    if (missing.length > 0) {
        const sample = missing.slice(0, 3).join(", ");
        const suffix = missing.length > 3 ? "..." : "";
        throw new Error(`Forbidden: ${resource} IDs are not owned by user: ${sample}${suffix}`);
    }
}

async function assertResourceOwnership({
    userId,
    toolName,
    params,
    resourceOverride,
}: {
    userId: string;
    toolName: string;
    params: ParamsRecord;
    resourceOverride?: string;
}): Promise<void> {
    const resource = resourceOverride ?? resolveResourceFromParams(params);
    if (!resource) return;
    const ids = extractIdsForOwnership(params);
    if (ids.length === 0) return;

    // Resource ownership checks for DB-backed resources. Provider-backed resources
    // (email/calendar/draft/contacts) are constrained by the owned account context.
    if (resource === "task") {
        await assertOwnedIds({
            ids,
            resource,
            fetchOwnedIds: async () => {
                const rows = await prisma.task.findMany({
                    where: { id: { in: ids }, userId },
                    select: { id: true },
                });
                return rows.map((row) => row.id);
            },
        });
        return;
    }

    if (resource === "approval") {
        await assertOwnedIds({
            ids,
            resource,
            fetchOwnedIds: async () => {
                const rows = await prisma.approvalRequest.findMany({
                    where: { id: { in: ids }, userId },
                    select: { id: true },
                });
                return rows.map((row) => row.id);
            },
        });
        return;
    }

    if (resource === "notification") {
        await assertOwnedIds({
            ids,
            resource,
            fetchOwnedIds: async () => {
                const rows = await prisma.inAppNotification.findMany({
                    where: { id: { in: ids }, userId },
                    select: { id: true },
                });
                return rows.map((row) => row.id);
            },
        });
        return;
    }

    if (resource === "conversation") {
        await assertOwnedIds({
            ids,
            resource,
            fetchOwnedIds: async () => {
                const rows = await prisma.conversation.findMany({
                    where: { id: { in: ids }, userId },
                    select: { id: true },
                });
                return rows.map((row) => row.id);
            },
        });
        return;
    }

    if (resource === "knowledge") {
        await assertOwnedIds({
            ids,
            resource,
            fetchOwnedIds: async () => {
                const rows = await prisma.knowledge.findMany({
                    where: { id: { in: ids }, userId },
                    select: { id: true },
                });
                return rows.map((row) => row.id);
            },
        });
        return;
    }

    if (resource === "automation" || resource === "patterns" || resource === "report") {
        const accountRows = await prisma.emailAccount.findMany({
            where: { userId },
            select: { id: true },
        });
        const emailAccountIds = accountRows.map((row) => row.id);
        if (emailAccountIds.length === 0) {
            throw new Error("Forbidden: no email accounts available for automation resources.");
        }
        const [ruleRows, knowledgeRows] = await Promise.all([
            prisma.rule.findMany({
                where: { id: { in: ids }, emailAccountId: { in: emailAccountIds } },
                select: { id: true },
            }),
            prisma.knowledge.findMany({
                where: { id: { in: ids }, userId },
                select: { id: true },
            }),
        ]);
        const ownedIds = new Set<string>([
            ...ruleRows.map((row) => row.id),
            ...knowledgeRows.map((row) => row.id),
        ]);
        const missing = ids.filter((id) => !ownedIds.has(id));
        if (missing.length > 0) {
            const sample = missing.slice(0, 3).join(", ");
            const suffix = missing.length > 3 ? "..." : "";
            throw new Error(`Forbidden: automation IDs are not owned by user: ${sample}${suffix}`);
        }
        return;
    }

    if (toolName === "send") {
        // send tool references draft IDs and is guarded by approval policy.
        // Ownership is validated downstream by provider/account scope.
        return;
    }
}

export async function checkPermissions(
    userId: string,
    toolName: string,
    params: unknown,
    context: PermissionContext = {},
): Promise<void> {
    // In a real app, we would check user roles/permissions from DB.
    // Here we enforce tool-name sanity and rely on approvals/policy layers for
    // context-aware gating of dangerous actions.
    if (!knownToolNames.has(toolName)) {
        throw new Error(`Unknown tool '${toolName}' is not allowed.`);
    }

    const input = asRecord(params);

    await assertEmailAccountOwnership(userId, context.emailAccountId);

    if (toolName === "workflow") {
        const steps = Array.isArray(input.steps) ? input.steps : [];
        if (steps.length === 0) {
            throw new Error("Workflow requires at least one step.");
        }
        for (let i = 0; i < steps.length; i++) {
            const step = asRecord(steps[i]);
            const stepAction = typeof step.action === "string" ? step.action : "";
            if (!stepAction || !Object.keys(TOOL_ALLOWED_RESOURCES).includes(stepAction)) {
                throw new Error(`Workflow step ${i} has unsupported action '${stepAction || "unknown"}'.`);
            }
            const stepResource = typeof step.resource === "string" ? step.resource : "";
            ensureResourceAllowedForTool({
                toolName: stepAction,
                resource: stepResource,
                context: `workflow step ${i}`,
            });
            await assertResourceOwnership({
                userId,
                toolName: stepAction,
                params: step,
                resourceOverride: stepResource,
            });
        }
        return;
    }

    if (toolName === "rules" || toolName === "triage" || toolName === "send") {
        // These tools don't use a resource discriminant in their public schema.
        return;
    }

    const resource = resolveResourceFromParams(input);
    if (!resource) {
        throw new Error(`Missing resource for ${toolName}.`);
    }
    ensureResourceAllowedForTool({
        toolName,
        resource,
        context: toolName,
    });
    await assertResourceOwnership({
        userId,
        toolName,
        params: input,
        resourceOverride: resource,
    });
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
        resource?: unknown;
    };

    if (toolName === "query" && limited.filter && typeof limited.filter.limit === "number") {
        const resource = typeof limited.resource === "string" ? limited.resource : undefined;
        const resourceLimit = resource ? QUERY_RESOURCE_LIMITS[resource] : undefined;
        const maxLimit = Math.min(
            LIMITS.maxItemsPerQuery,
            typeof resourceLimit === "number" ? resourceLimit : LIMITS.maxItemsPerQuery,
        );
        limited.filter.limit = Math.min(limited.filter.limit, maxLimit);
    }

    if (
        (toolName === "modify" || toolName === "create") &&
        Array.isArray(limited.ids) &&
        limited.ids.length > LIMITS.maxItemsPerModify
    ) {
        throw new Error(`Too many items. Max limit is ${LIMITS.maxItemsPerModify}.`);
    }

    if (toolName === "delete" && Array.isArray(limited.ids) && limited.ids.length > LIMITS.maxItemsPerDelete) {
        throw new Error(`Too many items. Max limit is ${LIMITS.maxItemsPerDelete}.`);
    }

    if (toolName === "get" && Array.isArray(limited.ids) && limited.ids.length > LIMITS.maxIdsPerGet) {
        throw new Error(`Too many IDs. Max limit is ${LIMITS.maxIdsPerGet}.`);
    }

    if (toolName === "create" && typeof limited?.data?.body === "string" && limited.data.body.length > LIMITS.maxBodyLength) {
        throw new Error(`Body exceeds max length (${LIMITS.maxBodyLength}).`);
    }

    return limited as T;
}
