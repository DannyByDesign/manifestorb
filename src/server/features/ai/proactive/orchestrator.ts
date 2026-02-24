import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { scanForAttentionItems } from "@/server/features/ai/proactive/scanner";
import type { AttentionItem } from "@/server/features/ai/proactive/types";
import { createInAppNotification } from "@/server/features/notifications/create";

const logger = createScopedLogger("ai/proactive/orchestrator");

const ACTIVE_LOOKBACK_DAYS = 30;
const DEFAULT_MAX_USERS = 500;
const MAX_NOTIFICATIONS_PER_USER = 2;

function urgencyRank(urgency: AttentionItem["urgency"]): number {
  if (urgency === "high") return 3;
  if (urgency === "medium") return 2;
  return 1;
}

function resolveThrottleWindowMs(type: AttentionItem["type"]): number {
  switch (type) {
    case "pending_approval":
      return 15 * 60 * 1000;
    case "upcoming_meeting":
      return 20 * 60 * 1000;
    case "unanswered_email":
      return 6 * 60 * 60 * 1000;
    case "overdue_task":
    case "follow_up_due":
    default:
      return 12 * 60 * 60 * 1000;
  }
}

function isQuietHours(now: Date, timeZone: string): boolean {
  const localHour = Number.parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
    10,
  );
  if (!Number.isFinite(localHour)) return false;
  return localHour >= 22 || localHour < 8;
}

function canBypassQuietHours(item: AttentionItem): boolean {
  if (item.type === "pending_approval") return true;
  if (item.type === "upcoming_meeting" && item.urgency === "high") return true;
  return false;
}

function buildDedupeKey(item: AttentionItem, now: Date): string {
  const bucket = Math.floor(now.getTime() / resolveThrottleWindowMs(item.type));
  const raw = `proactive:${item.type}:${item.relatedEntityType}:${item.relatedEntityId}:${bucket}`;
  return raw.length > 240 ? raw.slice(0, 240) : raw;
}

function rankAttentionItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((left, right) => {
    const urgencyDelta = urgencyRank(right.urgency) - urgencyRank(left.urgency);
    if (urgencyDelta !== 0) return urgencyDelta;
    if (left.actionable !== right.actionable) return left.actionable ? -1 : 1;
    return left.detectedAt.getTime() - right.detectedAt.getTime();
  });
}

export interface ProactiveAttentionSweepStats {
  scannedUsers: number;
  notificationsCreated: number;
  skippedNoItems: number;
  skippedQuietHours: number;
  errors: number;
}

export async function runProactiveAttentionSweep(params?: {
  userIds?: string[];
  maxUsers?: number;
  now?: Date;
}): Promise<ProactiveAttentionSweepStats> {
  const now = params?.now ?? new Date();
  const activeSince = new Date(now.getTime() - ACTIVE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const users = await prisma.user.findMany({
    where: params?.userIds
      ? {
          id: { in: params.userIds },
          emailAccounts: { some: {} },
        }
      : {
          emailAccounts: { some: {} },
          OR: [
            { lastLogin: { gte: activeSince } },
            { conversations: { some: { updatedAt: { gte: activeSince } } } },
          ],
        },
    select: {
      id: true,
      taskPreferences: {
        select: { timeZone: true },
      },
      emailAccounts: {
        select: { timezone: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
    take: params?.maxUsers ?? DEFAULT_MAX_USERS,
  });

  const stats: ProactiveAttentionSweepStats = {
    scannedUsers: users.length,
    notificationsCreated: 0,
    skippedNoItems: 0,
    skippedQuietHours: 0,
    errors: 0,
  };

  for (const user of users) {
    try {
      const items = rankAttentionItems(await scanForAttentionItems(user.id));
      if (items.length === 0) {
        stats.skippedNoItems += 1;
        continue;
      }

      const timeZone =
        user.taskPreferences?.timeZone?.trim() ||
        user.emailAccounts[0]?.timezone?.trim() ||
        "UTC";
      const quietHours = isQuietHours(now, timeZone);
      let sentForUser = 0;

      for (const item of items) {
        if (sentForUser >= MAX_NOTIFICATIONS_PER_USER) break;
        if (quietHours && !canBypassQuietHours(item)) {
          stats.skippedQuietHours += 1;
          continue;
        }

        const dedupeKey = buildDedupeKey(item, now);

        logger.info("Proactive attention item detected", {
          userId: user.id,
          title: item.title,
          type: item.type,
          urgency: item.urgency,
          dedupeKey,
        });

        await createInAppNotification({
          userId: user.id,
          title: item.title,
          body: item.description,
          type: "info",
          dedupeKey,
          metadata: {
            source: "proactive_attention",
            attentionType: item.type,
            urgency: item.urgency,
            relatedEntityId: item.relatedEntityId,
            relatedEntityType: item.relatedEntityType,
            actionable: item.actionable,
            suggestedAction: item.suggestedAction ?? null,
            detectedAt: item.detectedAt.toISOString(),
          },
        });

        sentForUser += 1;
        stats.notificationsCreated += 1;
      }
    } catch (error) {
      stats.errors += 1;
      logger.error("Proactive attention sweep failed for user", {
        userId: user.id,
        error,
      });
    }
  }

  logger.info("Proactive attention sweep completed", stats);
  return stats;
}
