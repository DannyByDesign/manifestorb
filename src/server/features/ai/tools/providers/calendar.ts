
import { env } from "@/env";
import { createCalendarEventProviders } from "@/features/calendar/event-provider";
import type {
  CalendarEvent,
  CalendarEventCreateInput,
  CalendarEventDeleteOptions,
  CalendarEventUpdateInput,
} from "@/features/calendar/event-types";
import prisma from "@/server/db/client";
import { createScopedLogger, type Logger } from "@/server/lib/logger";
import { CalendarServiceImpl } from "@/features/calendar/scheduling/CalendarServiceImpl";
import { TimeSlotManagerImpl } from "@/features/calendar/scheduling/TimeSlotManager";
import type { SchedulingSettings, SchedulingTask } from "@/features/calendar/scheduling/types";

export interface CalendarProvider {
  searchEvents(
    query: string,
    range: { start: Date; end: Date },
  ): Promise<CalendarEvent[]>;
  findAvailableSlots(options: {
    durationMinutes: number;
    start?: Date;
    end?: Date;
  }): Promise<Array<{ start: Date; end: Date; score: number }>>;
  getEvent(options: {
    eventId: string;
    calendarId?: string;
  }): Promise<CalendarEvent | null>;
  createEvent(options: {
    calendarId?: string;
    input: CalendarEventCreateInput;
  }): Promise<CalendarEvent>;
  updateEvent(options: {
    calendarId?: string;
    eventId: string;
    input: CalendarEventUpdateInput;
  }): Promise<CalendarEvent>;
  deleteEvent(options: {
    calendarId?: string;
    eventId: string;
    deleteOptions?: CalendarEventDeleteOptions;
  }): Promise<void>;
}

export async function createCalendarProvider(
  account: { id: string },
  userId: string,
  logger: Logger,
): Promise<CalendarProvider> {
  const scopedLogger = createScopedLogger("tools/calendar");
  const providers = await createCalendarEventProviders(account.id, logger);
  const providerByType = new Map(providers.map((provider) => [provider.provider, provider]));

  const resolveCalendarTarget = async (calendarId?: string) => {
    if (calendarId) {
      const calendar = await prisma.calendar.findFirst({
        where: {
          calendarId,
          connection: {
            emailAccountId: account.id,
            isConnected: true,
          },
          isEnabled: true,
        },
        select: {
          calendarId: true,
          connection: {
            select: { provider: true },
          },
        },
      });
      if (!calendar) {
        throw new Error("Calendar not found for account");
      }
      return {
        calendarId: calendar.calendarId,
        provider: calendar.connection.provider as "google" | "microsoft",
      };
    }

    const preferences = await prisma.taskPreference.findUnique({
      where: { userId },
      select: { selectedCalendarIds: true },
    });
    const preferredId = preferences?.selectedCalendarIds?.[0];
    if (preferredId) {
      const calendar = await prisma.calendar.findFirst({
        where: {
          calendarId: preferredId,
          connection: {
            emailAccountId: account.id,
          },
        },
        select: {
          calendarId: true,
          connection: {
            select: { provider: true },
          },
        },
      });
      if (calendar) {
        return {
          calendarId: calendar.calendarId,
          provider: calendar.connection.provider as "google" | "microsoft",
        };
      }
    }

    const fallback = await prisma.calendar.findFirst({
      where: {
        connection: { emailAccountId: account.id },
        isEnabled: true,
      },
      orderBy: { createdAt: "asc" },
      select: {
        calendarId: true,
        connection: {
          select: { provider: true },
        },
      },
    });
    if (!fallback) {
      throw new Error("No connected calendars found");
    }
    return {
      calendarId: fallback.calendarId,
      provider: fallback.connection.provider as "google" | "microsoft",
    };
  };

  const getProviderFor = async (calendarId?: string) => {
    if (!providers.length) {
      throw new Error("No calendar providers available");
    }
    const target = await resolveCalendarTarget(calendarId);
    const provider = providers.find((item) => item.provider === target.provider);
    if (!provider) {
      throw new Error("Calendar provider not available for account");
    }
    return { provider, calendarId: target.calendarId };
  };

  return {
    searchEvents: async (query, range) => {
      const preferences = await prisma.taskPreference.findUnique({
        where: { userId },
        select: { selectedCalendarIds: true },
      });
      const selectedCalendarIds = preferences?.selectedCalendarIds ?? [];

      let events: CalendarEvent[] = [];

      if (selectedCalendarIds.length > 0) {
        const calendars = await prisma.calendar.findMany({
          where: {
            calendarId: { in: selectedCalendarIds },
            isEnabled: true,
            connection: {
              emailAccountId: account.id,
              isConnected: true,
            },
          },
          select: {
            calendarId: true,
            connection: { select: { provider: true } },
          },
        });

        if (calendars.length === 0) {
          scopedLogger.warn("Selected calendars not found for search", {
            userId,
            selectedCalendarIds,
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
              timeMin: range.start,
              timeMax: range.end,
              maxResults: 250,
              calendarId: calendar.calendarId,
            });
          }),
        );
        events = results.flat();
      } else {
        const results = await Promise.all(
          providers.map((provider) =>
            provider.fetchEvents({
              timeMin: range.start,
              timeMax: range.end,
              maxResults: 250,
            }),
          ),
        );
        events = results.flat();
      }

      if (!query) return events;
      const normalized = query.toLowerCase();
      return events.filter((event) => {
        return (
          event.title.toLowerCase().includes(normalized) ||
          event.description?.toLowerCase().includes(normalized) ||
          event.attendees.some((attendee) =>
            attendee.email.toLowerCase().includes(normalized),
          )
        );
      });
    },
    findAvailableSlots: async ({ durationMinutes, start, end }) => {
      if (!env.NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED) {
        return [];
      }

      const preferences = await prisma.taskPreference.findUnique({
        where: { userId },
      });
      const settings: SchedulingSettings = preferences
        ? {
            workHourStart: preferences.workHourStart,
            workHourEnd: preferences.workHourEnd,
            workDays: preferences.workDays,
            bufferMinutes: preferences.bufferMinutes,
            selectedCalendarIds: preferences.selectedCalendarIds,
            timeZone: preferences.timeZone || "UTC",
            groupByProject: preferences.groupByProject,
          }
        : {
            workHourStart: 9,
            workHourEnd: 17,
            workDays: [1, 2, 3, 4, 5],
            bufferMinutes: 15,
            selectedCalendarIds: [],
            timeZone: "UTC",
            groupByProject: false,
          };

      const calendarService = new CalendarServiceImpl(account.id, scopedLogger);
      const timeSlotManager = new TimeSlotManagerImpl(settings, calendarService);

      const task: SchedulingTask = {
        id: "preview",
        userId,
        title: "Preview",
        durationMinutes,
        status: "PENDING",
      };

      const startDate = start ?? new Date();
      const endDate =
        end ?? new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      const slots = await timeSlotManager.findAvailableSlots(
        task,
        startDate,
        endDate,
      );

      return slots.map((slot) => ({
        start: slot.start,
        end: slot.end,
        score: slot.score,
      }));
    },
    getEvent: async ({ eventId, calendarId }) => {
      const { provider, calendarId: resolvedId } =
        await getProviderFor(calendarId);
      return provider.getEvent(eventId, resolvedId);
    },
    createEvent: async ({ calendarId, input }) => {
      const { provider, calendarId: resolvedId } =
        await getProviderFor(calendarId);
      return provider.createEvent(resolvedId, input);
    },
    updateEvent: async ({ calendarId, eventId, input }) => {
      const { provider, calendarId: resolvedId } =
        await getProviderFor(calendarId);
      return provider.updateEvent(resolvedId, eventId, input);
    },
    deleteEvent: async ({ calendarId, eventId, deleteOptions }) => {
      const { provider, calendarId: resolvedId } =
        await getProviderFor(calendarId);
      await provider.deleteEvent(resolvedId, eventId, deleteOptions);
    },
  };
}
