import type { Client } from "@microsoft/microsoft-graph-client";
import type { Logger } from "@/server/lib/logger";

const LOG_SOURCE = "MicrosoftCalendarSync";
const PAGE_SIZE = 200;

export interface OutlookEvent {
  id: string;
  iCalUId?: string;
  subject?: string;
  body?: { content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string };
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
  isAllDay?: boolean;
  showAs?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  isOrganizer?: boolean;
  attendees?: Array<{
    emailAddress: { address: string; name: string };
    status: { response: string };
  }>;
  seriesMasterId?: string;
  "@removed"?: boolean;
}

const now = new Date();
const timeMin = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
const timeMax = new Date(Date.UTC(now.getUTCFullYear() + 1, 11, 31));

export async function fetchAllEvents({
  client,
  calendarId,
  syncToken,
  forceFullSync,
  logger,
}: {
  client: Client;
  calendarId: string;
  syncToken?: string | null;
  forceFullSync?: boolean;
  logger: Logger;
}) {
  let allEvents: OutlookEvent[] = [];
  let nextLink: string | null = null;

  const apiPath = `/me/calendars/${calendarId}/calendarView/delta`;
  const queryParams: string[] = [];

  if (syncToken && !forceFullSync) {
    queryParams.push(`$deltatoken=${syncToken}`);
  } else {
    queryParams.push(`startDateTime=${timeMin.toISOString()}`);
    queryParams.push(`endDateTime=${timeMax.toISOString()}`);
  }

  let response = await client
    .api(
      apiPath + (queryParams.length ? `?${queryParams.join("&")}` : ""),
    )
    .header("Prefer", `odata.maxpagesize=${PAGE_SIZE}`)
    .get();

  allEvents = response.value || [];
  nextLink = response["@odata.nextLink"] ?? null;
  let deltaLink = response["@odata.deltaLink"];

  while (nextLink) {
    response = await client
      .api(nextLink)
      .header("Prefer", `odata.maxpagesize=${PAGE_SIZE}`)
      .get();
    allEvents = allEvents.concat(response.value || []);
    nextLink = response["@odata.nextLink"] ?? null;
    if (response["@odata.deltaLink"]) {
      deltaLink = response["@odata.deltaLink"];
    }
  }

  logger.trace("Outlook calendar sync fetched events", {
    source: LOG_SOURCE,
    totalEvents: String(allEvents.length),
    hasDeltaLink: !!deltaLink,
  });

  const deletedEvents = allEvents.filter((event) => event["@removed"]);
  const activeEvents = allEvents.filter((event) => !event["@removed"]);

  return {
    events: activeEvents,
    deletedEventIds: deletedEvents.map((event) => event.id),
    nextSyncToken: deltaLink?.split("deltatoken=")[1],
  };
}
