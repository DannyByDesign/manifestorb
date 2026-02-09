import prisma from "@/server/db/client";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { parseDateBoundInTimeZone } from "./timezone";

type DateRangeInput = {
  after?: string;
  before?: string;
};

type ResolveCalendarTimeRangeOptions = {
  userId: string;
  emailAccountId: string;
  requestedTimeZone?: string;
  dateRange?: DateRangeInput;
  defaultWindow: "today" | "next_7_days";
  // When one bound is missing, derive the other using this window size.
  missingBoundDurationMs: number;
};

function isValidTimeZone(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function startAndEndOfTodayInTimeZone(
  now: Date,
  timeZone: string,
): { start: Date; end: Date } {
  const localNow = toZonedTime(now, timeZone);
  const startOfDay = new Date(localNow);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(localNow);
  endOfDay.setHours(23, 59, 59, 999);

  return {
    start: fromZonedTime(startOfDay, timeZone),
    end: fromZonedTime(endOfDay, timeZone),
  };
}

export async function resolveDefaultCalendarTimeZone(options: {
  userId: string;
  emailAccountId: string;
}): Promise<{
  timeZone: string;
  source:
    | "integration"
    | "integration_primary_calendar"
    | "integration_calendar"
    | "preference";
} | {
  error: string;
}> {
  const { userId, emailAccountId } = options;
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: { timezone: true },
  });
  if (isValidTimeZone(emailAccount?.timezone)) {
    return { timeZone: emailAccount.timezone, source: "integration" };
  }

  const primaryCalendar = await prisma.calendar.findFirst({
    where: {
      connection: {
        emailAccountId,
        isConnected: true,
      },
      isEnabled: true,
      primary: true,
      timezone: { not: null },
    },
    select: { timezone: true },
  });
  if (isValidTimeZone(primaryCalendar?.timezone)) {
    return {
      timeZone: primaryCalendar.timezone,
      source: "integration_primary_calendar",
    };
  }

  const anyConnectedCalendar = await prisma.calendar.findFirst({
    where: {
      connection: {
        emailAccountId,
        isConnected: true,
      },
      isEnabled: true,
      timezone: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: { timezone: true },
  });
  if (isValidTimeZone(anyConnectedCalendar?.timezone)) {
    return {
      timeZone: anyConnectedCalendar.timezone,
      source: "integration_calendar",
    };
  }

  const preferences = await prisma.taskPreference.findUnique({
    where: { userId },
    select: { timeZone: true },
  });
  if (isValidTimeZone(preferences?.timeZone)) {
    return { timeZone: preferences.timeZone, source: "preference" };
  }

  return {
    error:
      "Unable to determine calendar timezone. Please set a timezone in your connected calendar integration settings.",
  };
}

export function resolveCalendarTimeZoneForRequest(options: {
  requestedTimeZone?: string;
  defaultTimeZone: string;
}): { timeZone: string } | { error: string } {
  const { requestedTimeZone, defaultTimeZone } = options;
  if (!requestedTimeZone) {
    return { timeZone: defaultTimeZone };
  }
  if (isValidTimeZone(requestedTimeZone)) {
    return { timeZone: requestedTimeZone };
  }
  return {
    error:
      `Invalid timezone "${requestedTimeZone}". Please provide a valid IANA timezone like "America/Los_Angeles" or "Europe/London".`,
  };
}

export async function resolveCalendarTimeRange(
  options: ResolveCalendarTimeRangeOptions,
): Promise<{ start: Date; end: Date; timeZone: string } | { error: string }> {
  const { userId, emailAccountId, requestedTimeZone, dateRange, defaultWindow, missingBoundDurationMs } = options;
  const defaultTimeZone = await resolveDefaultCalendarTimeZone({
    userId,
    emailAccountId,
  });
  if ("error" in defaultTimeZone) {
    return { error: defaultTimeZone.error };
  }
  const resolvedTimeZone = resolveCalendarTimeZoneForRequest({
    requestedTimeZone,
    defaultTimeZone: defaultTimeZone.timeZone,
  });
  if ("error" in resolvedTimeZone) {
    return { error: resolvedTimeZone.error };
  }
  const timeZone = resolvedTimeZone.timeZone;
  const now = new Date();

  if (!dateRange?.after && !dateRange?.before) {
    if (defaultWindow === "today") {
      const today = startAndEndOfTodayInTimeZone(now, timeZone);
      return { ...today, timeZone };
    }
    return {
      start: now,
      end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      timeZone,
    };
  }

  const parsedAfter = parseDateBoundInTimeZone(dateRange?.after, timeZone, "start");
  if (dateRange?.after && !parsedAfter) {
    return { error: "Invalid dateRange.after. Use an ISO-8601 timestamp or local date/time." };
  }
  const parsedBefore = parseDateBoundInTimeZone(dateRange?.before, timeZone, "end");
  if (dateRange?.before && !parsedBefore) {
    return { error: "Invalid dateRange.before. Use an ISO-8601 timestamp or local date/time." };
  }

  const defaultRangeStart =
    defaultWindow === "today"
      ? startAndEndOfTodayInTimeZone(now, timeZone).start
      : now;
  const defaultRangeEnd =
    defaultWindow === "today"
      ? startAndEndOfTodayInTimeZone(now, timeZone).end
      : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const start = parsedAfter ?? defaultRangeStart;
  const end =
    parsedBefore ??
    (parsedAfter
      ? new Date(parsedAfter.getTime() + missingBoundDurationMs)
      : defaultRangeEnd);

  if (start > end) {
    return { error: "Invalid date range: 'after' must be before 'before'." };
  }

  return { start, end, timeZone };
}
