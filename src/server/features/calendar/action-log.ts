import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("calendar/action-log");

export async function logCalendarAction(params: {
  userId: string;
  provider: "google" | "microsoft";
  action: "create" | "update" | "delete";
  calendarId?: string;
  eventId?: string;
  emailAccountId?: string;
  payload?: unknown;
  response?: unknown;
  error?: unknown;
}) {
  try {
    await prisma.calendarActionLog.create({
      data: {
        userId: params.userId,
        provider: params.provider,
        action: params.action,
        calendarId: params.calendarId,
        eventId: params.eventId,
        emailAccountId: params.emailAccountId,
        payload: params.payload ?? undefined,
        response: params.response ?? undefined,
        error: params.error ?? undefined,
      },
    });
  } catch (err) {
    logger.warn("Failed to log calendar action", { error: err });
  }
}

export async function wasRecentCalendarAction(params: {
  userId: string;
  eventId: string;
  withinMinutes?: number;
}) {
  const { userId, eventId, withinMinutes = 5 } = params;
  const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000);

  const recent = await prisma.calendarActionLog.findFirst({
    where: {
      userId,
      eventId,
      createdAt: { gte: cutoff },
    },
    select: { id: true },
  });

  return Boolean(recent);
}
