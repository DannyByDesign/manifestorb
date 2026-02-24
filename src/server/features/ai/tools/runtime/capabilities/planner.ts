import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { resolveCalendarTimeRange, resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
import { parseDateBoundInTimeZone, formatDateTimeForUser } from "@/server/features/ai/tools/timezone";
import { findCalendarAvailability } from "@/server/features/ai/tools/calendar/primitives";
import prisma from "@/server/db/client";

type PlannedAction = {
  toolName: string;
  args: Record<string, unknown>;
  rationale?: string;
};

type CalendarPlanItem = {
  id: string;
  title?: string | null;
  snippet?: string | null;
  start?: string | null;
  end?: string | null;
  startLocal?: string | null;
  endLocal?: string | null;
  location?: string | null;
  organizerEmail?: string | null;
  attendees?: unknown[];
};

type EmailPlanItem = {
  id: string;
  title?: string | null;
  snippet?: string | null;
  timestamp?: string | null;
  from?: string | null;
  subject?: string | null;
};

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isCalendarPlanItem(value: unknown): value is CalendarPlanItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.id === "string" && obj.id.length > 0;
}

function isEmailPlanItem(value: unknown): value is EmailPlanItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.id === "string" && obj.id.length > 0;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function computeConflicts(events: Array<{ start?: string | null; end?: string | null; id: string; title?: string | null }>) {
  const parsed = events
    .map((ev) => {
      const startIso = isoOrNull(ev.start);
      const endIso = isoOrNull(ev.end);
      return {
        id: ev.id,
        title: typeof ev.title === "string" ? ev.title : "",
        startIso,
        endIso,
        startMs: startIso ? Date.parse(startIso) : NaN,
        endMs: endIso ? Date.parse(endIso) : NaN,
      };
    })
    .filter((ev) => Number.isFinite(ev.startMs) && Number.isFinite(ev.endMs))
    .sort((a, b) => a.startMs - b.startMs);

  const conflicts: Array<{ a: string; b: string; overlapMinutes: number }> = [];
  let prev = parsed[0];
  for (let i = 1; i < parsed.length; i += 1) {
    const cur = parsed[i]!;
    if (prev && cur.startMs < prev.endMs) {
      conflicts.push({
        a: prev.id,
        b: cur.id,
        overlapMinutes: Math.max(1, Math.round((prev.endMs - cur.startMs) / 60_000)),
      });
      if (cur.endMs > prev.endMs) prev = cur;
    } else {
      prev = cur;
    }
  }
  return conflicts;
}

export interface PlannerCapabilities {
  composeDayPlan(input: {
    topEmailItems?: unknown[];
    calendarItems?: unknown[];
    focusSuggestions?: string[];
    request?: string;
    day?: string;
    start?: string;
    end?: string;
  }): Promise<ToolResult>;
  compileMultiActionPlan(input: {
    actions?: Array<Record<string, unknown>>;
    constraints?: Record<string, unknown>;
    request?: string;
  }): Promise<ToolResult>;
}

export function createPlannerCapabilities(env: CapabilityEnvironment): PlannerCapabilities {
  const calendarProvider = env.toolContext.providers.calendar;
  const emailProvider = env.toolContext.providers.email;

  const resolveTimeZone = async (): Promise<string> => {
    const resolved = await resolveDefaultCalendarTimeZone({
      userId: env.runtime.userId,
      emailAccountId: env.runtime.emailAccountId,
    });
    return "error" in resolved ? "UTC" : resolved.timeZone;
  };

  const resolveDayWindow = async (params: {
    request?: string;
    day?: string;
    start?: string;
    end?: string;
  }): Promise<{ start: Date; end: Date; timeZone: string } | { error: string }> => {
    const timeZone = await resolveTimeZone();

    const explicitStart = normalize(params.start);
    const explicitEnd = normalize(params.end);
    if (explicitStart || explicitEnd) {
      const start = explicitStart ? parseDateBoundInTimeZone(explicitStart, timeZone, "start") : null;
      const end = explicitEnd ? parseDateBoundInTimeZone(explicitEnd, timeZone, "end") : null;
      if ((explicitStart && !start) || (explicitEnd && !end)) {
        return { error: "invalid_planner_window" };
      }
      const resolvedStart = start ?? new Date();
      const resolvedEnd = end ?? new Date(resolvedStart.getTime() + 24 * 60 * 60 * 1000);
      return { start: resolvedStart, end: resolvedEnd, timeZone };
    }

    const day = normalize(params.day);
    if (day) {
      const range = await resolveCalendarTimeRange({
        userId: env.runtime.userId,
        emailAccountId: env.runtime.emailAccountId,
        requestedTimeZone: timeZone,
        dateRange: { after: day, before: day },
        relativeDateHintText: undefined,
        defaultWindow: "today",
        missingBoundDurationMs: 24 * 60 * 60 * 1000,
      });
      if ("error" in range) return { error: range.error };
      return { start: range.start, end: range.end, timeZone: range.timeZone };
    }

    const range = await resolveCalendarTimeRange({
      userId: env.runtime.userId,
      emailAccountId: env.runtime.emailAccountId,
      requestedTimeZone: timeZone,
      dateRange: undefined,
      relativeDateHintText: params.request,
      defaultWindow: "today",
      missingBoundDurationMs: 24 * 60 * 60 * 1000,
    });
    if ("error" in range) return { error: range.error };
    return { start: range.start, end: range.end, timeZone: range.timeZone };
  };

  return {
    async composeDayPlan(input) {
      try {
        const window = await resolveDayWindow({
          request: input.request,
          day: input.day,
          start: input.start,
          end: input.end,
        });
        if ("error" in window) {
          return {
            success: false,
            error: window.error,
            message: "I couldn't determine the day window for that plan.",
            clarification: {
              kind: "invalid_fields",
              prompt: "planner_day_window_invalid",
              missingFields: ["day"],
            },
          };
        }

        const timeZone = window.timeZone;
        const calendarItems: CalendarPlanItem[] =
          Array.isArray(input.calendarItems) && input.calendarItems.length > 0
            ? input.calendarItems.filter(isCalendarPlanItem)
            : await (async () => {
                const events = await calendarProvider.searchEvents("", {
                  start: window.start,
                  end: window.end,
                });

                return events.map((event) => ({
                  id: event.id,
                  title: event.title ?? null,
                  snippet: event.description ?? null,
                  start: event.startTime?.toISOString() ?? null,
                  end: event.endTime?.toISOString() ?? null,
                  startLocal: event.startTime
                    ? formatDateTimeForUser(event.startTime, timeZone)
                    : null,
                  endLocal: event.endTime
                    ? formatDateTimeForUser(event.endTime, timeZone)
                    : null,
                  location: event.location ?? null,
                  organizerEmail: event.organizerEmail ?? null,
                  attendees: event.attendees ?? [],
                }));
              })();

        const topEmailItems: EmailPlanItem[] =
          Array.isArray(input.topEmailItems) && input.topEmailItems.length > 0
            ? input.topEmailItems.filter(isEmailPlanItem)
            : await (async () => {
                const result = await emailProvider.search({
                  query: "in:inbox is:unread",
                  limit: 10,
                });
                return result.messages.map((message) => ({
                  id: message.threadId || message.id,
                  title: message.subject || message.headers?.subject || null,
                  snippet: message.snippet ?? message.textPlain ?? null,
                  timestamp: message.internalDate
                    ? new Date(message.internalDate).toISOString()
                    : null,
                  from: message.headers?.from ?? null,
                  subject: message.subject || message.headers?.subject || null,
                }));
              })();
        const topEmailSample = {
          kind: "planning_hint",
          query: "in:inbox is:unread",
          sampleLimit: 10,
          sampledCount: topEmailItems.length,
          authoritative: false,
        };

        const conflicts = computeConflicts(calendarItems);

        const preferences = await prisma.taskPreference.findUnique({
          where: { userId: env.runtime.userId },
          select: { workHourStart: true, workHourEnd: true },
        });
        const startHour = clampInt(preferences?.workHourStart ?? 9, 0, 23);
        const endHour = clampInt(preferences?.workHourEnd ?? 17, 1, 24);

        const freeSlots = await findCalendarAvailability(calendarProvider, {
          durationMinutes: 30,
          start: window.start,
          end: window.end,
        });

        const messageParts: string[] = [];
        messageParts.push(`Today (${timeZone}):`);

        if (calendarItems.length > 0) {
          messageParts.push("Calendar:");
          for (const ev of calendarItems.slice(0, 10)) {
            const title = typeof ev?.title === "string" ? ev.title : "(Untitled)";
            const when = typeof ev?.startLocal === "string" ? ev.startLocal : typeof ev?.start === "string" ? ev.start : "";
            const where = typeof ev?.location === "string" && ev.location ? ` @ ${ev.location}` : "";
            messageParts.push(`- ${title}${when ? ` (${when})` : ""}${where}`);
          }
        } else {
          messageParts.push("Calendar: no events found in that window.");
        }

        if (conflicts.length > 0) {
          messageParts.push(`Conflicts: ${conflicts.length} overlap${conflicts.length === 1 ? "" : "s"} detected.`);
        }

        const candidateSlots = freeSlots
          .filter((slot) => {
            const startLocal = new Date(formatDateTimeForUser(slot.start, timeZone));
            void startLocal;
            return true;
          })
          .slice(0, 5)
          .map((slot) => ({
            start: slot.start.toISOString(),
            end: slot.end.toISOString(),
            startLocal: formatDateTimeForUser(slot.start, timeZone),
            endLocal: formatDateTimeForUser(slot.end, timeZone),
          }));

        if (candidateSlots.length > 0) {
          messageParts.push("Free slots (30m):");
          for (const slot of candidateSlots) {
            messageParts.push(`- ${slot.startLocal} to ${slot.endLocal}`);
          }
        }

        if (topEmailItems.length > 0) {
          messageParts.push("Inbox sample (first unread threads, planning hint):");
          for (const it of topEmailItems.slice(0, 10)) {
            const title = typeof it?.title === "string" ? it.title : "(No subject)";
            const from = typeof it?.from === "string" ? it.from : null;
            messageParts.push(`- ${from ? `${from}: ` : ""}${title}`);
          }
        }

        messageParts.push(`Working hours used: ${startHour}:00-${endHour}:00.`);

        return {
          success: true,
          data: {
            window: {
              start: window.start.toISOString(),
              end: window.end.toISOString(),
              timeZone,
            },
            calendarItems,
            topEmailItems,
            topEmailSample,
            freeSlots: candidateSlots,
            conflicts,
            focusSuggestions: Array.isArray(input.focusSuggestions) ? input.focusSuggestions : [],
          },
          message: messageParts.join("\n"),
          meta: { resource: "planner", itemCount: 1 },
        };
      } catch (error) {
        env.runtime.logger.warn("Planner composeDayPlan failed", { error });
        return {
          success: false,
          error: "planner_compose_failed",
          message: "I couldn't build a day plan right now.",
        };
      }
    },

    async compileMultiActionPlan(input) {
      try {
        const requestedActions = Array.isArray(input.actions)
          ? input.actions
              .filter((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item))
              .map((item) => {
                const obj = item as Record<string, unknown>;
                const toolName = normalize(obj.toolName) || normalize(obj.tool) || normalize(obj.name);
                const args = asObject(obj.args ?? obj.parameters ?? obj.input);
                return toolName ? { toolName, args } : null;
              })
              .filter((entry): entry is PlannedAction => Boolean(entry))
          : [];

        const actions = requestedActions;

        return {
          success: true,
          data: {
            actions,
            constraints: input.constraints ?? {},
            actionCount: actions.length,
            inferredFromRequest: false,
          },
          message:
            actions.length === 0
              ? "No executable actions were found in that request."
              : `Compiled ${actions.length} action${actions.length === 1 ? "" : "s"} into an execution plan.`,
          meta: { resource: "planner", itemCount: actions.length },
        };
      } catch (error) {
        env.runtime.logger.warn("Planner compileMultiActionPlan failed", { error });
        return {
          success: false,
          error: "planner_compile_failed",
          message: "I couldn't compile that execution plan right now.",
        };
      }
    },
  };
}
