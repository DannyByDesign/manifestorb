import prisma from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { getQstashClient } from "@/server/integrations/qstash";
import { getInternalApiUrl } from "@/server/lib/internal-api";
import { createScopedLogger } from "@/server/lib/logger";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import {
    type NotificationContext,
    generateNotification,
} from "@/features/notifications/generator";

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

type SendNotificationParams = {
    context: NotificationContext;
    emailAccount: EmailAccountWithAI;
    userId: string;
    dedupeKey?: string;
    metadata?: Prisma.InputJsonValue;
};

/**
 * Single entry point for "notify the user about something."
 * Generates message text via LLM (with timeout + fallback), creates in-app notification,
 * and schedules channel delivery via QStash fallback.
 */
export async function sendNotification(params: SendNotificationParams) {
    const { context, emailAccount, userId, dedupeKey, metadata } = params;
    const message = await generateNotification(context, { emailAccount });
    const dbType =
        context.type === "calendar" ? "calendar" : "info";
    return createInAppNotification({
        userId,
        title: context.title,
        body: message,
        type: dbType,
        metadata: metadata ?? {},
        dedupeKey,
    });
}
