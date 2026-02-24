import type { calendar_v3 } from "@googleapis/calendar";
import { getCalendarClientWithRefresh } from "@/features/calendar/client";
import type {
  CalendarEvent,
  CalendarEventProvider,
  CalendarEventCreateInput,
  CalendarEventDeleteOptions,
  CalendarEventUpdateInput,
} from "@/features/calendar/event-types";
import type { Logger } from "@/server/lib/logger";
import {
  createGoogleEvent,
  deleteGoogleEvent,
  getGoogleEvent,
  updateGoogleEvent,
} from "@/server/integrations/google/calendar";

export interface GoogleCalendarConnectionParams {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  emailAccountId: string;
  userId?: string;
  timeZone?: string | null;
}

export class GoogleCalendarEventProvider implements CalendarEventProvider {
  provider = "google" as const;
  private readonly connection: GoogleCalendarConnectionParams;
  private readonly logger: Logger;
  private readonly userId?: string;
  private readonly timeZone?: string | null;

  constructor(connection: GoogleCalendarConnectionParams, logger: Logger) {
    this.connection = connection;
    this.logger = logger;
    this.userId = connection.userId;
    this.timeZone = connection.timeZone;
  }

  private async getClient(): Promise<calendar_v3.Calendar> {
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
    calendarId,
  }: {
    attendeeEmail: string;
    timeMin: Date;
    timeMax: Date;
    maxResults: number;
    calendarId?: string;
  }): Promise<CalendarEvent[]> {
    const client = await this.getClient();
    const targetCount = Math.max(1, maxResults);
    const filteredEvents: calendar_v3.Schema$Event[] = [];
    let nextPageToken: string | undefined;

    do {
      const response = await client.events.list({
        calendarId: calendarId ?? "primary",
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: Math.min(2500, targetCount),
        singleEvents: true,
        orderBy: "startTime",
        q: attendeeEmail,
        pageToken: nextPageToken,
      });

      const pageEvents = (response.data.items || []).filter((event) =>
        event.attendees?.some(
          (a) => a.email?.toLowerCase() === attendeeEmail.toLowerCase(),
        ),
      );
      filteredEvents.push(...pageEvents);
      nextPageToken = response.data.nextPageToken ?? undefined;
    } while (nextPageToken && filteredEvents.length < targetCount);

    return filteredEvents
      .slice(0, targetCount)
      .map((event) => this.parseEvent(event, calendarId));
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
    const targetCount = Math.max(1, maxResults || 10);
    const events: calendar_v3.Schema$Event[] = [];
    let nextPageToken: string | undefined;

    do {
      const response = await client.events.list({
        calendarId: calendarId ?? "primary",
        timeMin: timeMin?.toISOString(),
        timeMax: timeMax?.toISOString(),
        maxResults: Math.min(2500, targetCount - events.length),
        singleEvents: true,
        orderBy: "startTime",
        pageToken: nextPageToken,
      });

      events.push(...(response.data.items || []));
      nextPageToken = response.data.nextPageToken ?? undefined;
    } while (nextPageToken && events.length < targetCount);

    return events.slice(0, targetCount).map((event) => this.parseEvent(event, calendarId));
  }

  async getEvent(
    eventId: string,
    calendarId = "primary",
  ): Promise<CalendarEvent | null> {
    try {
      const result = await getGoogleEvent(
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

      const event = this.parseEvent(result.event, calendarId);
      const instances = result.instances?.map((instance) =>
        this.parseEvent(instance, calendarId),
      );

      return {
        ...event,
        instances,
      };
    } catch (error) {
      this.logger.warn("Failed to fetch Google event", { eventId, error });
      return null;
    }
  }

  async createEvent(
    calendarId: string,
    input: CalendarEventCreateInput,
  ): Promise<CalendarEvent> {
    const event = await createGoogleEvent(
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

    return this.parseEvent(event, calendarId);
  }

  async updateEvent(
    calendarId: string,
    eventId: string,
    input: CalendarEventUpdateInput,
  ): Promise<CalendarEvent> {
    const event = await updateGoogleEvent(
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

    return this.parseEvent(event, calendarId);
  }

  async deleteEvent(
    calendarId: string,
    eventId: string,
    options?: CalendarEventDeleteOptions,
  ): Promise<void> {
    await deleteGoogleEvent(
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

  private parseEvent(
    event: calendar_v3.Schema$Event,
    calendarId?: string,
  ): CalendarEvent {
    const startTime = new Date(
      event.start?.dateTime || event.start?.date || Date.now(),
    );
    const endTime = new Date(
      event.end?.dateTime || event.end?.date || Date.now(),
    );
    const isAllDay = Boolean(event.start?.date && !event.start?.dateTime);
    const organizerEmail = event.organizer?.email ?? event.creator?.email ?? undefined;

    let videoConferenceLink = event.hangoutLink ?? undefined;
    if (event.conferenceData?.entryPoints) {
      const videoEntry = event.conferenceData.entryPoints.find(
        (entry) => entry.entryPointType === "video",
      );
      videoConferenceLink = videoEntry?.uri ?? videoConferenceLink;
    }

    return {
      id: event.id || "",
      provider: "google",
      calendarId,
      iCalUid: event.iCalUID ?? undefined,
      seriesMasterId: event.recurringEventId ?? undefined,
      versionToken: event.etag ?? undefined,
      status: event.status ?? undefined,
      organizerEmail,
      canEdit: event.guestsCanModify ?? true,
      canRespond: true,
      busyStatus: event.transparency === "transparent" ? "free" : "busy",
      isAllDay,
      isDeleted: event.status === "cancelled",
      title: event.summary || "Untitled",
      description: event.description || undefined,
      location: event.location || undefined,
      eventUrl: event.htmlLink || undefined,
      videoConferenceLink,
      startTime,
      endTime,
      attendees:
        event.attendees?.map((attendee) => ({
          email: attendee.email || "",
          name: attendee.displayName ?? undefined,
        })) || [],
    };
  }
}
