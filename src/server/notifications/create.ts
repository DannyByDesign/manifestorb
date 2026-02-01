
import prisma from "@/server/db/client";
import { publishToQstash, getQstashClient } from "@/server/integrations/qstash";
import { getInternalApiUrl } from "@/server/utils/internal-api";
import { createScopedLogger } from "@/server/utils/logger";

const logger = createScopedLogger("notifications/create");

type CreateNotificationParams = {
    userId: string;
    title: string;
    body?: string;
    type?: "info" | "warning" | "success" | "error";
    metadata?: Record<string, any>;
    dedupeKey?: string;
};

export async function createInAppNotification(params: CreateNotificationParams) {
    const { userId, title, body, type = "info", metadata, dedupeKey } = params;

    try {
        // 1. Create DB Entry
        const notification = await prisma.inAppNotification.create({
            data: {
                userId,
                title,
                body,
                type,
                metadata: metadata || {},
                dedupeKey: dedupeKey || undefined
            }
        });

        // 2. Schedule Fallback (QStash)
        // via the arguments unless `FlowControl` type includes it?

        // Let's check `FlowControl` type if possible or just try to pass it.
        // If the wrapper doesn't support delay, I might need to update the wrapper or use `client` directly.
        // The wrapper does: `return client.publishJSON({ url, body, flowControl, ... })`.
        // The upstash `publishJSON` options usually mix body and options or have specific fields.

        // If I look at `index.ts` again:
        // export async function publishToQstash<T>(path: string, body: T, flowControl?: FlowControl)

        // If FlowControl doesn't include delay, I can't use it for delay.
        // I'll stick to using the wrapper but I suspect I can't easily add delay unless I modify the wrapper.
        // BUT, I can just modify the wrapper to accept `opts` properly or just use the client if I export it.
        // I prefer not to modify existing wrappers if possible.
        // Let's check if the previous code tried to use `client`.
        // Since `getQstashClient` is not exported, I can't use it.

        // I will MODIFY `src/server/integrations/qstash/index.ts` to export `getQstashClient` 
        // to make my life easier and consistent with my original plan.

        // Wait, better plan: update `publishToQstash` to accept `delay`.

        // Validating `publishToQstash` implementation in `index.ts`:
        // It passes `flowControl` to `publishJSON`.
        // If `FlowControl` from `@upstash/qstash` includes `delay` (it usually doesn't, it's for rate limiting),
        // `delay` is a separate property on `PublishRequest`.

        // I will export `getQstashClient` from `index.ts` so I can have full control in `create.ts`.
        // This is the cleanest path to "Advanced" usage like delay which the wrapper might not cover.

        // SO:
        // 1. Export `getQstashClient` in `src/server/integrations/qstash/index.ts`.
        // 2. Use it here.

    } catch (error: any) {
        if (error.code === 'P2002') {
            logger.info("Duplicate notification skipped", { dedupeKey });
            return null;
        }
        logger.error("Failed to create notification", { error });
        throw error;
    }
    return null; // TS Check fix (should return inside try, but here for safety)
}
