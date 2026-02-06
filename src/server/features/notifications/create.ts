
import prisma from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { getQstashClient } from "@/server/integrations/qstash";
import { getInternalApiUrl } from "@/server/lib/internal-api";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("notifications/create");

type CreateNotificationParams = {
    userId: string;
    title: string;
    body?: string;
    type?: "info" | "warning" | "success" | "error" | "approval" | "calendar";
    metadata?: Prisma.InputJsonValue;
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
                metadata: metadata ?? {},
                dedupeKey: dedupeKey || undefined
            }
        });

        // 2. Schedule Fallback (QStash)
        const client = getQstashClient();
        if (client) {
            const url = `${getInternalApiUrl()}/api/notifications/fallback`;
            await client.publishJSON({
                url,
                body: { id: notification.id },
                delay: 15,
                deduplicationId: dedupeKey ? `fallback-${dedupeKey}` : undefined,
                contentBasedDeduplication: false
            });
        }

        return notification;

    } catch (error: unknown) {
        const maybeCode =
            typeof error === "object" && error !== null && "code" in error
                ? (error as { code?: unknown }).code
                : undefined;
        if (maybeCode === "P2002") {
            logger.info("Duplicate notification skipped", { dedupeKey });
            return null;
        }
        logger.error("Failed to create notification", { error });
        throw error;
    }
}
