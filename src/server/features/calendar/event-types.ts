export interface CalendarEventAttendee {
  email: string;
  name?: string;
}

export interface CalendarEvent {
  id: string;
  provider?: "google" | "microsoft";
  calendarId?: string;
  iCalUid?: string;
  seriesMasterId?: string;
  versionToken?: string;
  status?: string;
  organizerEmail?: string;
  canEdit?: boolean;
  canRespond?: boolean;
  busyStatus?: string;
  isAllDay?: boolean;
  isDeleted?: boolean;
  title: string;
  description?: string;
  location?: string;
  eventUrl?: string;
  videoConferenceLink?: string;
  startTime: Date;
  endTime: Date;
  attendees: CalendarEventAttendee[];
  instances?: CalendarEvent[];
}

export interface CalendarEventCreateInput {
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  attendees?: string[];
  allDay?: boolean;
  isRecurring?: boolean;
  recurrenceRule?: string;
  timeZone?: string;
  /** When true, create a Google Meet / video conference link for the event. */
  addGoogleMeet?: boolean;
}

export interface CalendarEventUpdateInput
  extends Partial<CalendarEventCreateInput> {
  mode?: "single" | "series";
  instanceId?: string;
  originalStartTime?: string;
}

export interface CalendarEventDeleteOptions {
  mode?: "single" | "series";
  instanceId?: string;
  originalStartTime?: string;
}

export interface CalendarEventProvider {
  provider: "google" | "microsoft";
  fetchEventsWithAttendee(options: {
    attendeeEmail: string;
    timeMin: Date;
    timeMax: Date;
    maxResults: number;
    calendarId?: string;
  }): Promise<CalendarEvent[]>;

  fetchEvents(options: {
    timeMin?: Date;
    timeMax?: Date;
    maxResults?: number;
    calendarId?: string;
  }): Promise<CalendarEvent[]>;

  getEvent(eventId: string, calendarId?: string): Promise<CalendarEvent | null>;

  createEvent(
    calendarId: string,
    input: CalendarEventCreateInput,
  ): Promise<CalendarEvent>;

  updateEvent(
    calendarId: string,
    eventId: string,
    input: CalendarEventUpdateInput,
  ): Promise<CalendarEvent>;

  deleteEvent(
    calendarId: string,
    eventId: string,
    options?: CalendarEventDeleteOptions,
  ): Promise<void>;
}
