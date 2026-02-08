import type { Client } from "@microsoft/microsoft-graph-client";
import { getCalendarClientWithRefresh } from "@/server/integrations/microsoft/calendar-client";
import type {
  CalendarEvent,
  CalendarEventProvider,
  CalendarEventCreateInput,
  CalendarEventDeleteOptions,
  CalendarEventUpdateInput,
} from "@/features/calendar/event-types";
import type { Logger } from "@/server/lib/logger";
import {
  createOutlookEvent,
  deleteOutlookEvent,
  getOutlookEvent,
  updateOutlookEvent,
} from "@/server/integrations/microsoft/calendar";

export interface MicrosoftCalendarConnectionParams {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  emailAccountId: string;
  userId?: string;
  timeZone?: string | null;
}

type MicrosoftEvent = {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: Array<{
    emailAddress?: { address?: string; name?: string };
  }>;
  location?: { displayName?: string };
  webLink?: string;
  onlineMeeting?: { joinUrl?: string };
  onlineMeetingUrl?: string;
};

export class MicrosoftCalendarEventProvider implements CalendarEventProvider {
  provider: "microsoft" = "microsoft";
  private readonly connection: MicrosoftCalendarConnectionParams;
  private readonly logger: Logger;
  private readonly userId?: string;
  private readonly timeZone?: string | null;

  constructor(connection: MicrosoftCalendarConnectionParams, logger: Logger) {
    this.connection = connection;
    this.logger = logger;
    this.userId = connection.userId;
    this.timeZone = connection.timeZone;
  }

  private async getClient(): Promise<Client> {
    return getCalendarClientWithRefresh({
      accessToken: this.connection.accessToken,
      refreshToken: this.connection.refreshToken,
      expiresAt: this.connection.expiresAt,
      emailAccountId: this.connection.emailAccountId,
      logger: this.logger,
    });
  }

  async fetchEventsWithAttendee({
    attendeeEmail,
    timeMin,
    timeMax,
    maxResults,
  }: {
    attendeeEmail: string;
    timeMin: Date;
    timeMax: Date;
    maxResults: number;
  }): Promise<CalendarEvent[]> {
    const client = await this.getClient();

    // Use calendarView endpoint which correctly returns events overlapping the time range
    const response = await client
      .api("/me/calendar/calendarView")
      .query({
        startDateTime: timeMin.toISOString(),
        endDateTime: timeMax.toISOString(),
      })
      .top(maxResults * 3) // Fetch more to filter by attendee
      .orderby("start/dateTime")
      .get();

    const events: MicrosoftEvent[] = response.value || [];

    // Filter to events that have this attendee
    return events
      .filter((event) =>
        event.attendees?.some(
          (a) =>
            a.emailAddress?.address?.toLowerCase() ===
            attendeeEmail.toLowerCase(),
        ),
      )
      .slice(0, maxResults)
      .map((event) => this.parseEvent(event));
  }

  async fetchEvents({
    timeMin = new Date(),
    timeMax,
    maxResults,
    calendarId,
  }: {
    timeMin?: Date;
    timeMax?: Date;
    maxResults?: number;
    calendarId?: string;
  }): Promise<CalendarEvent[]> {
    const client = await this.getClient();

    // calendarView requires both start and end times, default to 30 days from timeMin
    const effectiveTimeMax =
      timeMax ?? new Date(timeMin.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Use calendarView endpoint which correctly returns events overlapping the time range
    const endpoint = calendarId
      ? `/me/calendars/${calendarId}/calendarView`
      : "/me/calendar/calendarView";
    const response = await client
      .api(endpoint)
      .query({
        startDateTime: timeMin.toISOString(),
        endDateTime: effectiveTimeMax.toISOString(),
      })
      .top(maxResults || 100)
      .orderby("start/dateTime")
      .get();

    const events: MicrosoftEvent[] = response.value || [];

    return events.map((event) => this.parseEvent(event));
  }

  async getEvent(
    eventId: string,
    calendarId?: string,
  ): Promise<CalendarEvent | null> {
    try {
      if (!calendarId) {
        const client = await this.getClient();
        const response = await client.api(`/me/events/${eventId}`).get();
        return response ? this.parseEvent(response) : null;
      }

      const result = await getOutlookEvent(
        {
          accessToken: this.connection.accessToken,
          refreshToken: this.connection.refreshToken,
          expiresAt: this.connection.expiresAt,
          emailAccountId: this.connection.emailAccountId,
          userId: this.userId,
          logger: this.logger,
        },
        calendarId,
        eventId,
      );

      const event = this.parseEvent(result.event);
      const instances = result.instances?.map((instance) =>
        this.parseEvent(instance),
      );

      return {
        ...event,
        instances,
      };
    } catch (error) {
      this.logger.warn("Failed to fetch Microsoft event", { eventId, error });
      return null;
    }
  }

  async createEvent(
    calendarId: string,
    input: CalendarEventCreateInput,
  ): Promise<CalendarEvent> {
    const event = await createOutlookEvent(
      {
        accessToken: this.connection.accessToken,
        refreshToken: this.connection.refreshToken,
        expiresAt: this.connection.expiresAt,
        emailAccountId: this.connection.emailAccountId,
        userId: this.userId,
        logger: this.logger,
      },
      calendarId,
      {
        ...input,
        timeZone: input.timeZone ?? this.timeZone ?? "UTC",
      },
    );

    return this.parseEvent(event);
  }

  async updateEvent(
    calendarId: string,
    eventId: string,
    input: CalendarEventUpdateInput,
  ): Promise<CalendarEvent> {
    const event = await updateOutlookEvent(
      {
        accessToken: this.connection.accessToken,
        refreshToken: this.connection.refreshToken,
        expiresAt: this.connection.expiresAt,
        emailAccountId: this.connection.emailAccountId,
        userId: this.userId,
        logger: this.logger,
      },
      calendarId,
      eventId,
      {
        ...input,
        timeZone: input.timeZone ?? this.timeZone ?? "UTC",
      },
    );

    return this.parseEvent(event);
  }

  async deleteEvent(
    calendarId: string,
    eventId: string,
    options?: CalendarEventDeleteOptions,
  ): Promise<void> {
    await deleteOutlookEvent(
      {
        accessToken: this.connection.accessToken,
        refreshToken: this.connection.refreshToken,
        expiresAt: this.connection.expiresAt,
        emailAccountId: this.connection.emailAccountId,
        userId: this.userId,
        logger: this.logger,
      },
      calendarId,
      eventId,
      options?.mode ?? "single",
    );
  }

  private parseEvent(event: MicrosoftEvent) {
    return {
      id: event.id || "",
      title: event.subject || "Untitled",
      description: event.bodyPreview || undefined,
      location: event.location?.displayName || undefined,
      eventUrl: event.webLink || undefined,
      videoConferenceLink:
        event.onlineMeeting?.joinUrl || event.onlineMeetingUrl || undefined,
      startTime: new Date(event.start?.dateTime || Date.now()),
      endTime: new Date(event.end?.dateTime || Date.now()),
      attendees:
        event.attendees?.map((attendee) => ({
          email: attendee.emailAddress?.address || "",
          name: attendee.emailAddress?.name ?? undefined,
        })) || [],
    };
  }
}
