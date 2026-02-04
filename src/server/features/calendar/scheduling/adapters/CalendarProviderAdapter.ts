import type { CalendarEvent } from "@/features/calendar/event-types";
import { createCalendarEventProviders } from "@/features/calendar/event-provider";
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";

export class CalendarProviderAdapter {
  constructor(
    private readonly emailAccountId: string,
    private readonly logger: Logger,
  ) {}

  async listEvents(
    start: Date,
    end: Date,
    calendarIds: string[] = [],
  ): Promise<CalendarEvent[]> {
    const providers = await createCalendarEventProviders(
      this.emailAccountId,
      this.logger,
    );
    if (providers.length === 0) {
      return [];
    }

    const providerByType = new Map(providers.map((provider) => [provider.provider, provider]));

    if (calendarIds.length > 0) {
      const calendars = await prisma.calendar.findMany({
        where: {
          calendarId: { in: calendarIds },
          isEnabled: true,
          connection: {
            emailAccountId: this.emailAccountId,
            isConnected: true,
          },
        },
        select: {
          calendarId: true,
          connection: { select: { provider: true } },
        },
      });

      if (calendars.length === 0) {
        this.logger.warn("Selected calendars not found for account", {
          emailAccountId: this.emailAccountId,
          calendarIds,
        });
        return [];
      }

      const results = await Promise.all(
        calendars.map((calendar) => {
          const provider = providerByType.get(
            calendar.connection.provider as "google" | "microsoft",
          );
          if (!provider) {
            return Promise.resolve<CalendarEvent[]>([]);
          }
          return provider.fetchEvents({
            timeMin: start,
            timeMax: end,
            maxResults: 500,
            calendarId: calendar.calendarId,
          });
        }),
      );

      return results.flat();
    }

    const calendars = await prisma.calendar.findMany({
      where: {
        isEnabled: true,
        connection: {
          emailAccountId: this.emailAccountId,
          isConnected: true,
        },
      },
      select: {
        calendarId: true,
        connection: { select: { provider: true } },
      },
    });

    if (calendars.length === 0) {
      const results = await Promise.all(
        providers.map((provider) =>
          provider.fetchEvents({
            timeMin: start,
            timeMax: end,
            maxResults: 500,
          }),
        ),
      );
      return results.flat();
    }

    const results = await Promise.all(
      calendars.map((calendar) => {
        const provider = providerByType.get(
          calendar.connection.provider as "google" | "microsoft",
        );
        if (!provider) {
          return Promise.resolve<CalendarEvent[]>([]);
        }
        return provider.fetchEvents({
          timeMin: start,
          timeMax: end,
          maxResults: 500,
          calendarId: calendar.calendarId,
        });
      }),
    );

    return results.flat();
  }
}
