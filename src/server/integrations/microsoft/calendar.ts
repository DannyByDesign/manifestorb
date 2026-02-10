import type { Client } from "@microsoft/microsoft-graph-client";
import { Frequency, RRule } from "rrule";
import type { Logger } from "@/server/lib/logger";
import { getCalendarClientWithRefresh } from "@/server/integrations/microsoft/calendar-client";
import { logCalendarAction } from "@/features/calendar/action-log";
import { normalizeRecurrenceRule, toDateOnly } from "@/features/calendar/utils";

const LOG_SOURCE = "MicrosoftCalendar";

export type MicrosoftCalendarConnectionParams = {
  accessToken?: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  emailAccountId: string;
  userId?: string;
  logger: Logger;
};

export interface MSGraphEvent {
  id: string;
  subject: string;
  body?: {
    contentType: string;
    content: string;
  };
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  location?: {
    displayName: string;
  };
  isAllDay?: boolean;
  recurrence?: {
    pattern: {
      type: string;
      interval: number;
      month?: number;
      dayOfMonth?: number;
      daysOfWeek?: string[];
      firstDayOfWeek?: string;
      index?: string;
    };
    range: {
      type: string;
      startDate: string;
      endDate?: string;
      numberOfOccurrences?: number;
    };
  };
  instances?: MSGraphEvent[];
  type?: "occurrence" | "exception" | "seriesMaster";
  seriesMasterId?: string;
  isOrganizer?: boolean;
  showAs?: string;
  attendees?: Array<{
    emailAddress: {
      address: string;
      name: string;
    };
    type: "required" | "optional";
    status: {
      response: "none" | "accepted" | "tentative" | "declined";
    };
  }>;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
}

type OutlookEventInput = {
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  isRecurring?: boolean;
  recurrenceRule?: string;
  timeZone: string;
};

type OutlookEventUpdate = Partial<Omit<OutlookEventInput, "timeZone">> & {
  timeZone?: string;
  mode?: "single" | "series";
};

async function getOutlookClient(
  params: MicrosoftCalendarConnectionParams,
): Promise<Client> {
  return getCalendarClientWithRefresh({
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    expiresAt: params.expiresAt,
    emailAccountId: params.emailAccountId,
    logger: params.logger,
  });
}

function createOutlookAllDayDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export async function createOutlookEvent(
  params: MicrosoftCalendarConnectionParams,
  calendarId: string,
  event: OutlookEventInput,
) {
  const client = await getOutlookClient(params);
  const timeZone = event.timeZone || "UTC";

  let recurrence;
  if (event.isRecurring && event.recurrenceRule) {
    const normalized = normalizeRecurrenceRule(event.recurrenceRule);
    const rrule = RRule.fromString(normalized ?? event.recurrenceRule);
    recurrence = convertRRuleToOutlookRecurrence(rrule);
  }

  let startDate = event.start;
  let endDate = event.end;

  if (event.allDay) {
    const startStr = toDateOnly(event.start);
    const endStr = toDateOnly(event.end);
    const sameDay = startStr === endStr;

    if (sameDay) {
      const nextDay = new Date(event.end);
      nextDay.setDate(nextDay.getDate() + 1);
      startDate = createOutlookAllDayDate(startStr);
      endDate = createOutlookAllDayDate(toDateOnly(nextDay));
    } else {
      startDate = createOutlookAllDayDate(startStr);
      endDate = createOutlookAllDayDate(endStr);
    }
  }

  const eventData = {
    subject: event.title,
    body: {
      contentType: "text",
      content: event.description || "",
    },
    start: {
      dateTime: startDate.toISOString(),
      timeZone,
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone,
    },
    location: event.location ? { displayName: event.location } : undefined,
    isAllDay: event.allDay,
    ...(recurrence && { recurrence }),
  };

  const response = await client
    .api(`/me/calendars/${calendarId}/events`)
    .post(eventData);
  if (params.userId) {
    await logCalendarAction({
      userId: params.userId,
      provider: "microsoft",
      action: "create",
      calendarId,
      eventId: response.id,
      emailAccountId: params.emailAccountId,
      payload: event,
      response,
    });
  }
  return response;
}

export async function getOutlookEvent(
  params: MicrosoftCalendarConnectionParams,
  calendarId: string,
  eventId: string,
) {
  const client = await getOutlookClient(params);

  try {
    const event = await client
      .api(`/me/calendars/${calendarId}/events/${eventId}`)
      .get();

    let instances: MSGraphEvent[] = [];
    let masterEvent = event;

    if (event.seriesMasterId) {
      try {
        masterEvent = await client
          .api(`/me/calendars/${calendarId}/events/${event.seriesMasterId}`)
          .get();
      } catch (error) {
        params.logger.error("Failed to get Outlook master event", {
          error,
          source: LOG_SOURCE,
        });
        masterEvent = event;
      }
    }

    if (masterEvent.recurrence) {
      const now = new Date();
      const response = await client
        .api(`/me/calendars/${calendarId}/events/${masterEvent.id}/instances`)
        .query({
          startDateTime: new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
            .toISOString(),
          endDateTime: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1))
            .toISOString(),
        })
        .get();

      instances = response.value || [];
    }

    return {
      event: masterEvent,
      instances,
    };
  } catch (error) {
    params.logger.error("Failed to get Outlook event", {
      error,
      source: LOG_SOURCE,
    });
    throw error;
  }
}

export async function updateOutlookEvent(
  params: MicrosoftCalendarConnectionParams,
  calendarId: string,
  eventId: string,
  event: OutlookEventUpdate,
) {
  const client = await getOutlookClient(params);
  const timeZone = event.timeZone ?? "UTC";

  try {
    const existingEvent = await client
      .api(`/me/calendars/${calendarId}/events/${eventId}`)
      .get();

    const targetEventId =
      event.mode === "series" && existingEvent.seriesMasterId
        ? existingEvent.seriesMasterId
        : eventId;

    let recurrence;
    if (event.isRecurring && event.recurrenceRule) {
      const normalized = normalizeRecurrenceRule(event.recurrenceRule);
      const rrule = RRule.fromString(normalized ?? event.recurrenceRule);
      recurrence = convertRRuleToOutlookRecurrence(rrule);
    }

    let startDate = event.start;
    let endDate = event.end;

    if (event.allDay && event.start && event.end) {
      const startStr = toDateOnly(event.start);
      const endStr = toDateOnly(event.end);
      const sameDay = startStr === endStr;

      if (sameDay) {
        const nextDay = new Date(event.end);
        nextDay.setDate(nextDay.getDate() + 1);
        startDate = createOutlookAllDayDate(startStr);
        endDate = createOutlookAllDayDate(toDateOnly(nextDay));
      } else {
        startDate = createOutlookAllDayDate(startStr);
        endDate = createOutlookAllDayDate(endStr);
      }
    }

    const response = await client
      .api(`/me/calendars/${calendarId}/events/${targetEventId}`)
      .patch({
        subject: event.title,
        body: event.description
          ? {
              contentType: "text",
              content: event.description,
            }
          : undefined,
        start: startDate
          ? {
              dateTime: startDate.toISOString(),
              timeZone,
            }
          : undefined,
        end: endDate
          ? {
              dateTime: endDate.toISOString(),
              timeZone,
            }
          : undefined,
        location: event.location ? { displayName: event.location } : undefined,
        isAllDay: event.allDay,
        recurrence,
      });

    if (params.userId) {
      await logCalendarAction({
        userId: params.userId,
        provider: "microsoft",
        action: "update",
        calendarId,
        eventId: response.id ?? eventId,
        emailAccountId: params.emailAccountId,
        payload: event,
        response,
      });
    }

    return response;
  } catch (error) {
    params.logger.error("Failed to update Outlook event", {
      error,
      source: LOG_SOURCE,
      eventId,
    });
    if (params.userId) {
      await logCalendarAction({
        userId: params.userId,
        provider: "microsoft",
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

export async function deleteOutlookEvent(
  params: MicrosoftCalendarConnectionParams,
  calendarId: string,
  eventId: string,
  mode: "single" | "series" = "single",
) {
  const client = await getOutlookClient(params);

  try {
    const event = await client
      .api(`/me/calendars/${calendarId}/events/${eventId}`)
      .get();

    const targetEventId =
      mode === "series" && event.seriesMasterId ? event.seriesMasterId : eventId;

    await client
      .api(`/me/calendars/${calendarId}/events/${targetEventId}`)
      .delete();
    if (params.userId) {
      await logCalendarAction({
        userId: params.userId,
        provider: "microsoft",
        action: "delete",
        calendarId,
        eventId: targetEventId,
        emailAccountId: params.emailAccountId,
        payload: { mode },
      });
    }
  } catch (error) {
    params.logger.error("Failed to delete Outlook event", {
      error,
      source: LOG_SOURCE,
    });
    if (params.userId) {
      await logCalendarAction({
        userId: params.userId,
        provider: "microsoft",
        action: "delete",
        calendarId,
        eventId,
        emailAccountId: params.emailAccountId,
        payload: { mode },
        error,
      });
    }
    throw error;
  }
}

function convertRRuleToOutlookRecurrence(rrule: RRule) {
  const options = rrule.options;
  const pattern: {
    type: string;
    interval: number;
    daysOfWeek?: string[];
    dayOfMonth?: number;
    month?: number;
  } = {
    type: Frequency[options.freq].toLowerCase(),
    interval: options.interval || 1,
  };

  if (options.byweekday) {
    pattern.daysOfWeek = options.byweekday.map(
      (day: number | { toString: () => string }) => {
        if (typeof day === "number") {
          const days = [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
          ];
          return days[day];
        }
        const weekdayMap: { [key: string]: string } = {
          SU: "sunday",
          MO: "monday",
          TU: "tuesday",
          WE: "wednesday",
          TH: "thursday",
          FR: "friday",
          SA: "saturday",
        };
        const dayStr = day.toString().toUpperCase();
        return weekdayMap[dayStr];
      },
    );
  }

  if (options.bymonthday) {
    pattern.dayOfMonth = options.bymonthday[0];
  }

  if (options.bymonth) {
    pattern.month = options.bymonth[0];
  }

  const startDateStr = options.dtstart.toISOString().split("T")[0];

  const range: {
    type: "endDate" | "numbered" | "noEnd";
    startDate: string;
    endDate?: string;
    numberOfOccurrences?: number;
  } = {
    type: options.until ? "endDate" : options.count ? "numbered" : "noEnd",
    startDate: startDateStr,
  };

  if (options.until) {
    range.endDate = options.until.toISOString().split("T")[0];
  }

  if (options.count) {
    range.numberOfOccurrences = options.count;
  }

  return { pattern, range };
}

export function convertOutlookRecurrenceToRRule(recurrence: {
  pattern: {
    type: string;
    interval: number;
    daysOfWeek?: string[];
    dayOfMonth?: number;
    month?: number;
    firstDayOfWeek?: string;
    index?: string;
  };
  range: {
    type: string;
    startDate: string;
    endDate?: string;
    numberOfOccurrences?: number;
    recurrenceTimeZone?: string;
  };
}): string {
  let freq = recurrence.pattern.type.toUpperCase();
  if (freq === "RELATIVEMONTHLY") {
    freq = "MONTHLY";
  }

  const interval = recurrence.pattern.interval;
  const parts = [`FREQ=${freq}`, `INTERVAL=${interval}`];

  if (recurrence.pattern.daysOfWeek?.length) {
    if (recurrence.pattern.type === "relativemonthly" && recurrence.pattern.index) {
      const weekIndex =
        {
          first: 1,
          second: 2,
          third: 3,
          fourth: 4,
          last: -1,
        }[recurrence.pattern.index.toLowerCase()] || 1;

      const days = recurrence.pattern.daysOfWeek
        .map((day) => `${weekIndex}${day.slice(0, 2).toUpperCase()}`)
        .join(",");
      parts.push(`BYDAY=${days}`);
    } else {
      const days = recurrence.pattern.daysOfWeek
        .map((day) => day.slice(0, 2).toUpperCase())
        .join(",");
      parts.push(`BYDAY=${days}`);
    }
  }

  if (recurrence.pattern.dayOfMonth) {
    parts.push(`BYMONTHDAY=${recurrence.pattern.dayOfMonth}`);
  }

  if (recurrence.pattern.month) {
    parts.push(`BYMONTH=${recurrence.pattern.month}`);
  }

  if (
    recurrence.range.type === "numbered" &&
    recurrence.range.numberOfOccurrences
  ) {
    parts.push(`COUNT=${recurrence.range.numberOfOccurrences}`);
  } else if (recurrence.range.type === "endDate" && recurrence.range.endDate) {
    const untilDate = recurrence.range.endDate.replace(/-/g, "");
    parts.push(`UNTIL=${untilDate}T235959Z`);
  }

  const dtstart = recurrence.range.startDate.replace(/-/g, "");
  parts.push(`DTSTART=${dtstart}T000000Z`);

  return `RRULE:${parts.join(";")}`;
}
