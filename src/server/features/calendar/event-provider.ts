import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import type { CalendarEventProvider } from "@/features/calendar/event-types";
import { GoogleCalendarEventProvider } from "@/features/calendar/providers/google-events";
import { MicrosoftCalendarEventProvider } from "@/features/calendar/providers/microsoft-events";
import { isGoogleProvider } from "@/features/email/provider-types";

/**
 * Create calendar event providers for all connected calendars.
 * Fetches calendar connections once and creates providers that can be reused.
 */
export async function createCalendarEventProviders(
  emailAccountId: string,
  logger: Logger,
): Promise<CalendarEventProvider[]> {
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      userId: true,
      timezone: true,
    },
  });

  if (!emailAccount) {
    logger.warn("Email account not found for calendar providers", {
      emailAccountId,
    });
    return [];
  }

  const connections = await prisma.calendarConnection.findMany({
    where: {
      emailAccountId,
      isConnected: true,
    },
    select: {
      id: true,
      provider: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
    },
  });

  if (connections.length === 0) {
    logger.info("No calendar connections found", { emailAccountId });
    return [];
  }

  const providers: CalendarEventProvider[] = [];

  for (const connection of connections) {
    if (!connection.refreshToken) continue;

    try {
      if (isGoogleProvider(connection.provider)) {
        providers.push(
          new GoogleCalendarEventProvider(
            {
              accessToken: connection.accessToken,
              refreshToken: connection.refreshToken,
              expiresAt: connection.expiresAt?.getTime() ?? null,
              emailAccountId,
              userId: emailAccount.userId,
              timeZone: emailAccount.timezone,
            },
            logger,
          ),
        );
      } else if (connection.provider === "microsoft") {
        providers.push(
          new MicrosoftCalendarEventProvider(
            {
              accessToken: connection.accessToken,
              refreshToken: connection.refreshToken,
              expiresAt: connection.expiresAt?.getTime() ?? null,
              emailAccountId,
              userId: emailAccount.userId,
              timeZone: emailAccount.timezone,
            },
            logger,
          ),
        );
      }
    } catch (error) {
      logger.error("Failed to create calendar event provider", {
        provider: connection.provider,
        error,
      });
    }
  }

  return providers;
}
