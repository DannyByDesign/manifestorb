import { z } from "zod";
import { tool } from "ai";
import type { Logger } from "@/server/lib/logger";
import { createGenerateText } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { getUnifiedCalendarAvailability } from "@/features/calendar/unified-availability";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { EmailForLLM } from "@/server/types";
import prisma from "@/server/db/client";
import { getUserInfoPrompt } from "@/features/ai/helpers";

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

  const userTimezone = getUserTimezone(emailAccount, calendarConnections);

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

  const system = `You are an AI assistant that analyzes email threads to determine if they contain meeting or scheduling requests, and returns available meeting time slots.

TIMEZONE: All times (busy periods, suggested times) are in ${userTimezone}.

Your task is to:
1. Analyze if the email is scheduling-related (meeting, call, appointment)
2. Extract any date/time preferences from the email
3. If calendars are connected, use checkCalendarAvailability to get busy periods (already in ${userTimezone})
4. Suggest ONLY times that DO NOT overlap with busy periods
5. Return time slots with start AND end times (infer duration from context: "quick call" = 30min, "meeting" = 60min)
6. If there are NO available times (user is busy all day), set noAvailability=true and return empty suggestedTimes array
7. If calendars are not connected, do NOT call checkCalendarAvailability; suggest times based on email context only

CRITICAL: Do NOT suggest times overlapping with busy periods.
Example: If busy 2025-11-17 09:00 to 2025-11-17 17:00, suggest times AFTER 17:00 or BEFORE 09:00.
Example: If busy all day (00:00 to 23:59), return empty array and set noAvailability=true.

Format: "YYYY-MM-DD HH:MM"
If email mentions timezone (e.g., "5pm PST"), convert to ${userTimezone}.
Call "returnSuggestedTimes" only once.`;

  const prompt = `${getUserInfoPrompt({ emailAccount })}
  
<current_time>
${new Date().toISOString()}
</current_time>

<thread>
${threadContent}
</thread>`.trim();

  const modelOptions = getModel();

  const generateText = createGenerateText({
    emailAccount,
    label: "Calendar availability analysis",
    modelOptions,
  });

  let result: CalendarAvailabilityContext | null = null;

  const response = await generateText({
    ...modelOptions,
    system,
    prompt,
    stopWhen: (result) =>
      result.steps.some((step) =>
        step.toolCalls?.some(
          (call) => call?.toolName === "returnSuggestedTimes",
        ),
      ) || result.steps.length > 5,
    tools: {
      ...(hasCalendarConnections
        ? {
            checkCalendarAvailability: tool({
              description:
                "Check calendar availability across all connected calendars (Google and Microsoft) for meeting requests",
              inputSchema: z.object({
                timeMin: z
                  .string()
                  .describe("The minimum time to check availability for"),
                timeMax: z
                  .string()
                  .describe("The maximum time to check availability for"),
              }),
              execute: async ({ timeMin, timeMax }) => {
                const startDate = new Date(timeMin);
                const endDate = new Date(timeMax);

                try {
                  const busyPeriods = await getUnifiedCalendarAvailability({
                    emailAccountId: emailAccount.id,
                    startDate,
                    endDate,
                    timezone: userTimezone,
                    logger,
                  });

                  logger.trace("Unified calendar availability data", {
                    busyPeriods,
                  });

                  return { busyPeriods };
                } catch (error) {
                  logger.error("Error checking calendar availability", { error });
                  return { busyPeriods: [] };
                }
              },
            }),
          }
        : {}),
      returnSuggestedTimes: tool({
        description: "Return suggested times for a meeting",
        inputSchema: schema,
        execute: async (data) => {
          result = data;
        },
      }),
    },
  });

  if (!result) {
    const toolCall = response.steps
      .flatMap((step) => step.toolCalls ?? [])
      .find((call) => call?.toolName === "returnSuggestedTimes");

    if (toolCall?.input) {
      const parsed = schema.safeParse(toolCall.input);
      if (parsed.success) {
        result = parsed.data;
      }
    }
  }

  if (result && result.suggestedTimes.length === 0 && !result.noAvailability) {
    result = {
      ...result,
      suggestedTimes: buildFallbackSuggestedTimes(),
    };
  }

  return result;
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

function getUserTimezone(
  emailAccount: EmailAccountWithAI,
  calendarConnections: Array<{
    calendars: Array<{
      calendarId: string;
      timezone: string | null;
      primary: boolean;
    }>;
  }>,
): string {
  // First priority: user's explicitly set timezone
  if (emailAccount.timezone) {
    return emailAccount.timezone;
  }

  // Second: try to find the primary calendar's timezone
  for (const connection of calendarConnections) {
    const primaryCalendar = connection.calendars.find((cal) => cal.primary);
    if (primaryCalendar?.timezone) {
      return primaryCalendar.timezone;
    }
  }

  // Third: find any calendar with a timezone
  for (const connection of calendarConnections) {
    for (const calendar of connection.calendars) {
      if (calendar.timezone) {
        return calendar.timezone;
      }
    }
  }

  // Last resort: UTC
  return "UTC";
}
