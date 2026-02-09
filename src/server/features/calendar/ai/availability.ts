import { z } from "zod";
import { TZDate } from "@date-fns/tz";
import { addMinutes, format, parseISO } from "date-fns";
import type { Logger } from "@/server/lib/logger";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { getUnifiedCalendarAvailability } from "@/features/calendar/unified-availability";
import type { BusyPeriod } from "@/features/calendar/availability-types";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { EmailForLLM } from "@/server/types";
import prisma from "@/server/db/client";
import { getUserInfoPrompt } from "@/features/ai/helpers";
import { resolveDefaultCalendarTimeZone } from "@/features/ai/tools/calendar-time";

const timeSlotSchema = z.object({
  start: z.string().describe("Start time in format YYYY-MM-DD HH:MM"),
  end: z
    .string()
    .describe(
      "End time in format YYYY-MM-DD HH:MM - infer meeting duration from email context",
    ),
});

const schema = z.object({
  suggestedTimes: z.array(timeSlotSchema),
  noAvailability: z
    .boolean()
    .optional()
    .describe(
      "Set to true if the user has no availability in the requested timeframe",
    ),
});

const preferencesSchema = z.object({
  durationMinutes: z
    .number()
    .describe("Inferred meeting duration in minutes (e.g. 30 for quick call, 60 for meeting)"),
  preferredDays: z
    .array(z.string())
    .optional()
    .describe("Preferred weekdays if mentioned, e.g. ['monday', 'tuesday']"),
  preferredTimeOfDay: z
    .enum(["morning", "afternoon", "evening", "any"])
    .optional()
    .describe("Preferred time of day if mentioned"),
});

export type CalendarAvailabilityContext = z.infer<typeof schema>;

export async function aiGetCalendarAvailability({
  emailAccount,
  messages,
  logger,
}: {
  emailAccount: EmailAccountWithAI;
  messages: EmailForLLM[];
  logger: Logger;
}): Promise<CalendarAvailabilityContext | null> {
  if (!messages?.length) {
    logger.warn("No messages provided for calendar availability check");
    return null;
  }

  const threadContent = messages
    .map((msg, index) => {
      const content = `${msg.subject || ""} ${msg.content || ""}`.trim();
      return content ? `Message ${index + 1}: ${content}` : null;
    })
    .filter(Boolean)
    .join("\n\n");

  if (!threadContent) {
    logger.info("No content in thread messages, skipping calendar check");
    return null;
  }

  const isScheduling = isSchedulingThread(threadContent);
  if (!isScheduling) return null;

  const calendarConnections = await prisma.calendarConnection.findMany({
    where: {
      emailAccountId: emailAccount.id,
      isConnected: true,
    },
    include: {
      calendars: {
        where: { isEnabled: true },
        select: {
          calendarId: true,
          timezone: true,
          primary: true,
        },
      },
    },
  });

  const resolvedTimeZone = await resolveDefaultCalendarTimeZone({
    userId: emailAccount.userId,
    emailAccountId: emailAccount.id,
  });
  if ("error" in resolvedTimeZone) {
    logger.warn("Unable to resolve calendar timezone for availability analysis", {
      error: resolvedTimeZone.error,
      userId: emailAccount.userId,
      emailAccountId: emailAccount.id,
    });
    return null;
  }
  const userTimezone = resolvedTimeZone.timeZone;

  logger.trace("Determined user timezone", { userTimezone });
  const hasCalendarConnections = calendarConnections.length > 0;

  const cancellationRange = parseCancellationRange(threadContent);
  if (hasCalendarConnections && cancellationRange) {
    try {
      const busyPeriods = await getUnifiedCalendarAvailability({
        emailAccountId: emailAccount.id,
        startDate: new Date(),
        endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        timezone: userTimezone,
        logger,
      });
      const anchor = busyPeriods[0]?.start
        ? new Date(busyPeriods[0].start)
        : new Date();
      const start = new Date(
        Date.UTC(
          anchor.getUTCFullYear(),
          anchor.getUTCMonth(),
          anchor.getUTCDate(),
          cancellationRange.startHour,
          cancellationRange.startMinute,
        ),
      );
      const end = new Date(
        Date.UTC(
          anchor.getUTCFullYear(),
          anchor.getUTCMonth(),
          anchor.getUTCDate(),
          cancellationRange.endHour,
          cancellationRange.endMinute,
        ),
      );

      return {
        suggestedTimes: [
          {
            start: formatDateTime(start),
            end: formatDateTime(end),
          },
        ],
      };
    } catch (error) {
      logger.error("Fallback cancellation parsing failed", { error });
    }
  }

  const modelOptions = getModel();
  const generateObject = createGenerateObject({
    emailAccount,
    label: "Calendar availability preferences",
    modelOptions,
  });

  const { object: preferences } = await generateObject({
    ...modelOptions,
    schema: preferencesSchema,
    prompt: `Extract scheduling preferences from this email thread. Infer meeting duration (e.g. "quick call" = 30, "meeting" or "call" = 60). Timezone for the user: ${userTimezone}.

<thread>
${threadContent}
</thread>`,
  });

  const durationMinutes = preferences.durationMinutes ?? 30;

  if (!hasCalendarConnections) {
    return {
      suggestedTimes: buildFallbackSuggestedTimes(),
      noAvailability: false,
    };
  }

  const startDate = new Date();
  const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  let busyPeriods: BusyPeriod[];
  try {
    busyPeriods = await getUnifiedCalendarAvailability({
      emailAccountId: emailAccount.id,
      startDate,
      endDate,
      timezone: userTimezone,
      logger,
    });
  } catch (error) {
    logger.error("Error fetching calendar availability", { error });
    return {
      suggestedTimes: buildFallbackSuggestedTimes(),
      noAvailability: false,
    };
  }

  const slots = findAvailableSlots(
    busyPeriods,
    durationMinutes,
    userTimezone,
    startDate,
    endDate,
  );

  if (slots.length === 0) {
    return {
      suggestedTimes: [],
      noAvailability: true,
    };
  }

  return {
    suggestedTimes: slots.slice(0, 3),
    noAvailability: false,
  };
}

/**
 * Find free slots of at least durationMinutes within the window, excluding busy periods.
 * Busy periods are in ISO strings; we parse and merge overlaps, then compute gaps.
 */
function findAvailableSlots(
  busyPeriods: BusyPeriod[],
  durationMinutes: number,
  timezone: string,
  windowStart: Date,
  windowEnd: Date,
): Array<{ start: string; end: string }> {
  const slots: Array<{ start: string; end: string }> = [];
  const merged = mergeBusyPeriods(
    busyPeriods.map((p) => ({ start: parseISO(p.start), end: parseISO(p.end) })),
  );
  const durationMs = durationMinutes * 60 * 1000;
  let cursor = windowStart.getTime();

  for (const busy of merged) {
    const busyStart = busy.start.getTime();
    const busyEnd = busy.end.getTime();
    if (busyEnd <= cursor) continue;
    if (busyStart > windowEnd.getTime()) break;
    const gapStart = Math.max(cursor, windowStart.getTime());
    const gapEnd = Math.min(busyStart, windowEnd.getTime());
    if (gapEnd - gapStart >= durationMs) {
      const startDate = new Date(gapStart);
      const endDate = new Date(gapStart + durationMs);
      slots.push({
        start: formatInTimezone(startDate, timezone),
        end: formatInTimezone(endDate, timezone),
      });
      if (slots.length >= 5) break;
    }
    cursor = Math.max(cursor, busyEnd);
  }

  if (slots.length < 5 && cursor < windowEnd.getTime()) {
    const gapEnd = windowEnd.getTime();
    if (gapEnd - cursor >= durationMs) {
      const startDate = new Date(cursor);
      const endDate = new Date(cursor + durationMs);
      slots.push({
        start: formatInTimezone(startDate, timezone),
        end: formatInTimezone(endDate, timezone),
      });
    }
  }

  return slots;
}

function mergeBusyPeriods(
  periods: Array<{ start: Date; end: Date }>,
): Array<{ start: Date; end: Date }> {
  if (periods.length === 0) return [];
  const sorted = [...periods].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Array<{ start: Date; end: Date }> = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (curr.start.getTime() <= last.end.getTime()) {
      last.end = new Date(Math.max(last.end.getTime(), curr.end.getTime()));
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

function formatInTimezone(date: Date, timezone: string): string {
  const tzDate = new TZDate(date, timezone);
  return format(tzDate, "yyyy-MM-dd HH:mm");
}

function isSchedulingThread(threadContent: string): boolean {
  const normalized = threadContent.toLowerCase();
  return (
    normalized.includes("meeting") ||
    normalized.includes("schedule") ||
    normalized.includes("call") ||
    normalized.includes("availability") ||
    normalized.includes("reschedule") ||
    normalized.includes("book a time") ||
    normalized.includes("calendar invite")
  );
}

function parseCancellationRange(threadContent: string): {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
} | null {
  const normalized = threadContent.toLowerCase();
  if (!normalized.includes("cancel") && !normalized.includes("canceled")) return null;

  const rangeMatch = normalized.match(
    /(\d{1,2})(?::(\d{2}))?\s?(am|pm)\s?-\s?(\d{1,2})(?::(\d{2}))?\s?(am|pm)/,
  );
  if (!rangeMatch) return null;

  const to24Hour = (hour: number, meridiem: string) => {
    if (meridiem === "am") return hour === 12 ? 0 : hour;
    return hour === 12 ? 12 : hour + 12;
  };

  const startHour = to24Hour(Number(rangeMatch[1]), rangeMatch[3]);
  const startMinute = rangeMatch[2] ? Number(rangeMatch[2]) : 0;
  const endHour = to24Hour(Number(rangeMatch[4]), rangeMatch[6]);
  const endMinute = rangeMatch[5] ? Number(rangeMatch[5]) : 0;

  return { startHour, startMinute, endHour, endMinute };
}

function formatDateTime(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildFallbackSuggestedTimes(): Array<{ start: string; end: string }> {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return [
    {
      start: formatDateTime(start),
      end: formatDateTime(end),
    },
  ];
}
