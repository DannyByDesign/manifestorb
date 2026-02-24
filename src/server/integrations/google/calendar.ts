import type { calendar_v3 } from "@googleapis/calendar";
import type { Logger } from "@/server/lib/logger";
import { getCalendarClientWithRefresh } from "@/features/calendar/client";
import { logCalendarAction } from "@/features/calendar/action-log";
import {
  normalizeRecurrenceRule,
  startOfYear,
  toDateOnly,
} from "@/features/calendar/utils";

export type GoogleCalendarConnectionParams = {
  accessToken?: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  emailAccountId: string;
  userId?: string;
  logger: Logger;
};

export type GoogleCalendarEventInput = {
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  attendees?: string[];
  allDay?: boolean;
  isRecurring?: boolean;
  recurrenceRule?: string;
  timeZone: string;
  /** When true, requests a Google Meet link for the event (requires conferenceDataVersion=1). */
  addGoogleMeet?: boolean;
};

export type GoogleCalendarEventUpdate = Partial<
  Omit<GoogleCalendarEventInput, "timeZone">
> & {
  timeZone?: string;
  mode?: "single" | "series";
  instanceId?: string;
  originalStartTime?: string;
};

type GoogleEvent = calendar_v3.Schema$Event;

async function getGoogleCalendarClient(
  params: GoogleCalendarConnectionParams,
): Promise<calendar_v3.Calendar> {
  return getCalendarClientWithRefresh({
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    expiresAt: params.expiresAt,
    emailAccountId: params.emailAccountId,
    logger: params.logger,
  });
}

function normalizeInstanceOriginalStart(value: string | undefined): string | null {
  if (!value || value.trim().length === 0) return null;
  const trimmed = value.trim();
  const parsed = new Date(trimmed);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  return /^\d{4}-\d{2}-\d{2}$/u.test(trimmed) ? trimmed : null;
}

function instanceOriginalStartValue(
  instance: calendar_v3.Schema$Event,
): string | null {
  return normalizeInstanceOriginalStart(
    instance.originalStartTime?.dateTime ?? instance.originalStartTime?.date ?? undefined,
  );
}

async function resolveRecurringInstanceEventId(params: {
  calendar: calendar_v3.Calendar;
  calendarId: string;
  recurringEventId: string;
  instanceId?: string;
  originalStartTime?: string;
}): Promise<string> {
  if (params.instanceId && params.instanceId.trim().length > 0) {
    return params.instanceId.trim();
  }

  const normalizedOriginalStart = normalizeInstanceOriginalStart(
    params.originalStartTime,
  );
  if (!normalizedOriginalStart) {
    throw new Error(
      "recurring_instance_identity_required: provide instanceId or originalStartTime",
    );
  }

  const parsedOriginalStart = new Date(normalizedOriginalStart);
  const timeMin = Number.isFinite(parsedOriginalStart.getTime())
    ? new Date(parsedOriginalStart.getTime() - 24 * 60 * 60 * 1000).toISOString()
    : undefined;
  const timeMax = Number.isFinite(parsedOriginalStart.getTime())
    ? new Date(parsedOriginalStart.getTime() + 24 * 60 * 60 * 1000).toISOString()
    : undefined;

  const instances = await params.calendar.events.instances({
    calendarId: params.calendarId,
    eventId: params.recurringEventId,
    ...(timeMin ? { timeMin } : {}),
    ...(timeMax ? { timeMax } : {}),
    maxResults: 100,
  });

  const matched = (instances.data.items ?? []).find((instance) => {
    const instanceStart = instanceOriginalStartValue(instance);
    return instanceStart === normalizedOriginalStart;
  });
  const matchedId = matched?.id?.trim();
  if (!matchedId) {
    throw new Error("recurring_instance_not_found");
  }
  return matchedId;
}

export async function createGoogleEvent(
  params: GoogleCalendarConnectionParams,
  calendarId: string,
  event: GoogleCalendarEventInput,
) {
  const calendar = await getGoogleCalendarClient(params);

  const recurrence = event.isRecurring
    ? [normalizeRecurrenceRule(event.recurrenceRule)!].filter(Boolean)
    : undefined;

  const requestBody: calendar_v3.Schema$Event = {
    summary: event.title,
    description: event.description,
    location: event.location,
    attendees: event.attendees?.map((email) => ({ email })),
    start: {
      dateTime: event.allDay ? undefined : event.start.toISOString(),
      date: event.allDay ? toDateOnly(event.start) : undefined,
      timeZone: event.timeZone,
    },
    end: {
      dateTime: event.allDay ? undefined : event.end.toISOString(),
      date: event.allDay ? toDateOnly(event.end) : undefined,
      timeZone: event.timeZone,
    },
    recurrence,
  };

  if (event.addGoogleMeet) {
    requestBody.conferenceData = {
      createRequest: {
        requestId: `amodel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const response = await calendar.events.insert({
    calendarId,
    conferenceDataVersion: event.addGoogleMeet ? 1 : 0,
    requestBody,
  });

  if (params.userId) {
    await logCalendarAction({
      userId: params.userId,
      provider: "google",
      action: "create",
      calendarId,
      eventId: response.data.id ?? undefined,
      emailAccountId: params.emailAccountId,
      payload: event,
      response: response.data,
    });
  }

  return response.data;
}

export async function updateGoogleEvent(
  params: GoogleCalendarConnectionParams,
  calendarId: string,
  eventId: string,
  event: GoogleCalendarEventUpdate,
) {
  const calendar = await getGoogleCalendarClient(params);
  const timeZone = event.timeZone ?? "UTC";
  const attendees =
    event.attendees === undefined
      ? undefined
      : event.attendees.map((email) => ({ email }));

  try {
    const existingEvent = await calendar.events.get({
      calendarId,
      eventId,
    });

    if (event.mode === "series" && existingEvent.data.recurringEventId) {
      const recurrence = event.recurrenceRule
        ? [normalizeRecurrenceRule(event.recurrenceRule)!].filter(Boolean)
        : undefined;

      const response = await calendar.events.patch({
        calendarId,
        eventId: existingEvent.data.recurringEventId,
        requestBody: {
          summary: event.title,
          description: event.description,
          location: event.location,
          attendees,
          start: event.start
            ? {
                dateTime: event.allDay ? undefined : event.start.toISOString(),
                date: event.allDay ? toDateOnly(event.start) : undefined,
                timeZone,
              }
            : undefined,
          end: event.end
            ? {
                dateTime: event.allDay ? undefined : event.end.toISOString(),
                date: event.allDay ? toDateOnly(event.end) : undefined,
                timeZone,
              }
            : undefined,
          recurrence,
        },
      });
      if (params.userId) {
        await logCalendarAction({
          userId: params.userId,
          provider: "google",
          action: "update",
          calendarId,
          eventId: response.data.id ?? eventId,
          emailAccountId: params.emailAccountId,
          payload: event,
          response: response.data,
        });
      }

      return response.data;
    }

    const recurringMasterId =
      existingEvent.data.recurringEventId ??
      (existingEvent.data.recurrence ? eventId : undefined);

    if (event.mode === "single" && recurringMasterId) {
      const instanceEventId = await resolveRecurringInstanceEventId({
        calendar,
        calendarId,
        recurringEventId: recurringMasterId,
        instanceId: event.instanceId,
        originalStartTime: event.originalStartTime,
      });

      const response = await calendar.events.patch({
        calendarId,
        eventId: instanceEventId,
        requestBody: {
          summary: event.title,
          description: event.description,
          location: event.location,
          attendees,
          start: event.start
            ? {
                dateTime: event.allDay ? undefined : event.start.toISOString(),
                date: event.allDay ? toDateOnly(event.start) : undefined,
                timeZone,
              }
            : undefined,
          end: event.end
            ? {
                dateTime: event.allDay ? undefined : event.end.toISOString(),
                date: event.allDay ? toDateOnly(event.end) : undefined,
                timeZone,
              }
            : undefined,
        },
      });
      if (params.userId) {
        await logCalendarAction({
          userId: params.userId,
          provider: "google",
          action: "update",
          calendarId,
          eventId: response.data.id ?? instanceEventId,
          emailAccountId: params.emailAccountId,
          payload: event,
          response: response.data,
        });
      }

      return response.data;
    }

    const response = await calendar.events.patch({
      calendarId,
      eventId,
      requestBody: {
        summary: event.title,
        description: event.description,
        location: event.location,
        attendees,
        start: event.start
          ? {
              dateTime: event.allDay ? undefined : event.start.toISOString(),
              date: event.allDay ? toDateOnly(event.start) : undefined,
              timeZone,
            }
          : undefined,
        end: event.end
          ? {
              dateTime: event.allDay ? undefined : event.end.toISOString(),
              date: event.allDay ? toDateOnly(event.end) : undefined,
              timeZone,
            }
          : undefined,
        recurrence: event.recurrenceRule
          ? [normalizeRecurrenceRule(event.recurrenceRule)!].filter(Boolean)
          : undefined,
      },
    });
    if (params.userId) {
      await logCalendarAction({
        userId: params.userId,
        provider: "google",
        action: "update",
        calendarId,
        eventId: response.data.id ?? eventId,
        emailAccountId: params.emailAccountId,
        payload: event,
        response: response.data,
      });
    }

    return response.data;
  } catch (error) {
    params.logger.error("Failed to update Google Calendar event", {
      error,
      calendarId,
      eventId,
    });
    if (params.userId) {
      await logCalendarAction({
        userId: params.userId,
        provider: "google",
        action: "update",
        calendarId,
        eventId,
        emailAccountId: params.emailAccountId,
        payload: event,
        error,
      });
    }
    throw error;
  }
}

export async function deleteGoogleEvent(
  params: GoogleCalendarConnectionParams,
  calendarId: string,
  eventId: string,
  options: {
    mode?: "single" | "series";
    instanceId?: string;
    originalStartTime?: string;
  } = {},
) {
  const calendar = await getGoogleCalendarClient(params);
  const mode = options.mode ?? "single";

  try {
    const event = await calendar.events.get({
      calendarId,
      eventId,
    });

    if (mode === "series" && event.data.recurringEventId) {
      await calendar.events.delete({
        calendarId,
        eventId: event.data.recurringEventId,
      });
      if (params.userId) {
        await logCalendarAction({
          userId: params.userId,
          provider: "google",
          action: "delete",
          calendarId,
          eventId: event.data.recurringEventId,
          emailAccountId: params.emailAccountId,
          payload: { mode },
        });
      }
      return;
    }

    const recurringMasterId =
      event.data.recurringEventId ??
      (event.data.recurrence ? eventId : undefined);

    if (mode === "single" && recurringMasterId) {
      const instanceEventId = await resolveRecurringInstanceEventId({
        calendar,
        calendarId,
        recurringEventId: recurringMasterId,
        instanceId: options.instanceId,
        originalStartTime: options.originalStartTime,
      });
      await calendar.events.delete({
        calendarId,
        eventId: instanceEventId,
      });
      if (params.userId) {
        await logCalendarAction({
          userId: params.userId,
          provider: "google",
          action: "delete",
          calendarId,
          eventId: instanceEventId,
          emailAccountId: params.emailAccountId,
          payload: { mode, instanceId: options.instanceId, originalStartTime: options.originalStartTime },
        });
      }
      return;
    }

    await calendar.events.delete({
      calendarId,
      eventId,
    });
    if (params.userId) {
      await logCalendarAction({
        userId: params.userId,
        provider: "google",
        action: "delete",
        calendarId,
        eventId,
        emailAccountId: params.emailAccountId,
        payload: { mode },
      });
    }
  } catch (error) {
    params.logger.error("Failed to delete Google Calendar event", {
      error,
      calendarId,
      eventId,
    });
    if (params.userId) {
      await logCalendarAction({
        userId: params.userId,
        provider: "google",
        action: "delete",
        calendarId,
        eventId,
        emailAccountId: params.emailAccountId,
        payload: {
          mode,
          instanceId: options.instanceId,
          originalStartTime: options.originalStartTime,
        },
        error,
      });
    }
    throw error;
  }
}

export async function getGoogleEvent(
  params: GoogleCalendarConnectionParams,
  calendarId: string,
  eventId: string,
) {
  const googleCalendarClient = await getGoogleCalendarClient(params);

  try {
    const eventResponse = await googleCalendarClient.events.get({
      calendarId,
      eventId,
    });
    const event = eventResponse.data;

    let instances: GoogleEvent[] = [];
    let masterEvent = event;

    if (event.recurringEventId) {
      try {
        const masterResponse = await googleCalendarClient.events.get({
          calendarId,
          eventId: event.recurringEventId,
        });
        masterEvent = masterResponse.data;
      } catch (error) {
        params.logger.warn("Failed to get Google master event", {
          error,
          calendarId,
          eventId,
        });
        masterEvent = event;
      }
    }

    if (masterEvent.recurrence) {
      const year = new Date().getUTCFullYear();
      const instancesResponse = await googleCalendarClient.events.instances({
        calendarId,
        eventId: masterEvent.id || "",
        timeMin: startOfYear(year).toISOString(),
        timeMax: startOfYear(year + 1).toISOString(),
      });
      instances = instancesResponse.data.items || [];
    }

    return {
      event: masterEvent,
      instances,
    };
  } catch (error) {
    params.logger.error("Failed to get Google Calendar event", {
      error,
      calendarId,
      eventId,
    });
    throw error;
  }
}
