import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createUnifiedSearchService } from "@/server/features/search/unified/service";
import { resolveCalendarTimeRange, resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
import { parseDateBoundInTimeZone, formatDateTimeForUser } from "@/server/features/ai/tools/timezone";
import { findCalendarAvailability } from "@/server/features/ai/tools/calendar/primitives";
import prisma from "@/server/db/client";

type PlannedAction = {
  toolName: string;
  args: Record<string, unknown>;
  rationale?: string;
};

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function detectXpActions(request: string, timeZone: string): PlannedAction[] {
  const q = request.toLowerCase();
  const actions: PlannedAction[] = [];

  if (q.includes("missing location") && q.includes("draft")) {
    actions.push({
      toolName: "calendar.listEvents",
      args: {
        dateRange: { after: new Date().toISOString(), before: new Date(Date.now() + 7 * 864e5).toISOString(), timeZone },
        limit: 50,
      },
      rationale: "Find upcoming events to identify missing location fields.",
    });
    actions.push({
      toolName: "email.createDraft",
      args: {
        // Placeholder: caller should populate to/subject/body per event.
      },
      rationale: "Draft follow-up emails to organizers for events missing a location.",
    });
  }

  if (q.includes("archive") && q.includes("newsletter") && q.includes("focus block")) {
    actions.push({
      toolName: "email.batchArchive",
      args: {
        filter: { query: "unsubscribe", mailbox: "inbox" },
        limit: 50,
      },
      rationale: "Archive low-priority newsletter-like messages.",
    });
    actions.push({
      toolName: "calendar.createFocusBlock",
      args: {
        // Placeholder: caller should fill start/end using availability.
      },
      rationale: "Create a single focus block.",
    });
  }

  if (q.includes("reschedule") && q.includes("task") && q.includes("tomorrow")) {
    const today = new Date();
    const ymd = new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(today);

    actions.push({
      toolName: "task.bulkReschedule",
      args: {
        dueDateRange: { after: ymd, before: ymd },
        // Placeholder: caller should set windowStart/windowEnd for tomorrow.
      },
      rationale: "Reschedule tasks due today into tomorrow's free window.",
    });
  }

  if (/\btop\s*3\b/u.test(q) && q.includes("email") && q.includes("repl") && q.includes("schedule")) {
    actions.push({
      toolName: "email.searchInbox",
      args: { unread: true, sort: "newest", limit: 3 },
      rationale: "Identify top inbox items likely needing replies.",
    });
    actions.push({
      toolName: "calendar.findAvailability",
      args: { durationMinutes: 30 },
      rationale: "Find a 30-minute slot to respond.",
    });
    actions.push({
      toolName: "calendar.createEvent",
      args: { title: "Email replies" },
      rationale: "Block time on the calendar to reply.",
    });
  }

  return actions;
}

function computeConflicts(events: Array<{ start?: string | null; end?: string | null; id: string; title: string }>) {
  const parsed = events
    .map((ev) => {
      const startIso = isoOrNull(ev.start);
      const endIso = isoOrNull(ev.end);
      return {
        id: ev.id,
        title: ev.title,
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
  const unifiedSearch = createUnifiedSearchService({
    userId: env.runtime.userId,
    emailAccountId: env.runtime.emailAccountId,
    email: env.runtime.email,
    logger: env.runtime.logger,
    providers: env.toolContext.providers,
  });

  const calendarProvider = env.toolContext.providers.calendar;

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
        const calendarItems =
          Array.isArray(input.calendarItems) && input.calendarItems.length > 0
            ? input.calendarItems
            : await (async () => {
                const result = await unifiedSearch.query({
                  scopes: ["calendar"],
                  dateRange: {
                    after: window.start.toISOString(),
                    before: window.end.toISOString(),
                    timeZone,
                  },
                  limit: 100,
                });

                return result.items
                  .filter((it) => it.surface === "calendar")
                  .map((it) => {
                    const md = asObject(it.metadata);
                    return {
                      id: typeof md.eventId === "string" ? md.eventId : it.id,
                      title: it.title,
                      snippet: it.snippet,
                      start: typeof md.start === "string" ? md.start : null,
                      end: typeof md.end === "string" ? md.end : null,
                      startLocal:
                        typeof md.start === "string" ? formatDateTimeForUser(new Date(md.start), timeZone) : null,
                      endLocal:
                        typeof md.end === "string" ? formatDateTimeForUser(new Date(md.end), timeZone) : null,
                      location: typeof md.location === "string" ? md.location : null,
                      organizerEmail: typeof md.authorIdentity === "string" ? md.authorIdentity : null,
                      attendees: Array.isArray(md.attendees) ? md.attendees : [],
                    };
                  });
              })();

        const topEmailItems =
          Array.isArray(input.topEmailItems) && input.topEmailItems.length > 0
            ? input.topEmailItems
            : await (async () => {
                const result = await unifiedSearch.query({
                  scopes: ["email"],
                  mailbox: "inbox",
                  unread: true,
                  sort: "newest",
                  limit: 10,
                });

                return result.items
                  .filter((it) => it.surface === "email")
                  .map((it) => {
                    const md = asObject(it.metadata);
                    return {
                      id: typeof md.threadId === "string" ? md.threadId : it.id,
                      title: it.title,
                      snippet: it.snippet,
                      timestamp: it.timestamp ?? null,
                      from: typeof md.from === "string" ? md.from : typeof md.authorIdentity === "string" ? md.authorIdentity : null,
                      subject: it.title,
                    };
                  });
              })();

        const conflicts = computeConflicts(
          (Array.isArray(calendarItems) ? calendarItems : []).filter(
            (item): item is any => Boolean(item) && typeof item === "object" && "id" in (item as any),
          ) as any,
        );

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

        if (Array.isArray(calendarItems) && calendarItems.length > 0) {
          messageParts.push("Calendar:");
          for (const ev of calendarItems.slice(0, 10) as any[]) {
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

        if (Array.isArray(topEmailItems) && topEmailItems.length > 0) {
          messageParts.push("Urgent inbox (unread):");
          for (const it of topEmailItems.slice(0, 10) as any[]) {
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
        const request = normalize(input.request);
        const timeZone = await resolveTimeZone();

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

        const inferred = request ? detectXpActions(request, timeZone) : [];
        const actions = requestedActions.length > 0 ? requestedActions : inferred;

        return {
          success: true,
          data: {
            actions,
            constraints: input.constraints ?? {},
            actionCount: actions.length,
            inferredFromRequest: requestedActions.length === 0 && inferred.length > 0,
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
