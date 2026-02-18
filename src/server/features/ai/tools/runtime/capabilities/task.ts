import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import prisma from "@/server/db/client";
import { capabilityFailureResult } from "@/server/features/ai/tools/runtime/capabilities/errors";
import {
  formatDateTimeForUser,
  parseDateBoundInTimeZone,
} from "@/server/features/ai/tools/timezone";
import {
  resolveCalendarTimeZoneForRequest,
  resolveDefaultCalendarTimeZone,
} from "@/server/features/ai/tools/calendar-time";
import {
  createCalendarEvent,
  findCalendarAvailability,
  listCalendarEvents,
  updateCalendarEvent,
} from "@/server/features/ai/tools/calendar/primitives";

export interface TaskCapabilities {
  reschedule(input: Record<string, unknown>): Promise<ToolResult>;
  list(input: Record<string, unknown>): Promise<ToolResult>;
  bulkReschedule(input: Record<string, unknown>): Promise<ToolResult>;
}

type ResolveTaskResult =
  | {
      task: {
        id: string;
        title: string;
        durationMinutes: number | null;
        scheduledStart: Date | null;
        scheduledEnd: Date | null;
      };
    }
  | {
      error: ToolResult;
    };

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function taskFailure(error: unknown, message: string): ToolResult {
  return capabilityFailureResult(error, message, { resource: "task" });
}

export function createTaskCapabilities(env: CapabilityEnvironment): TaskCapabilities {
  const provider = env.toolContext.providers.calendar;
  const defaultRescheduleWindowMs = 14 * 24 * 60 * 60 * 1000;

  const resolveTask = async (
    input: Record<string, unknown>,
  ): Promise<ResolveTaskResult> => {
    const taskId = safeString(input.taskId);
    const taskTitle =
      safeString(input.taskTitle) ??
      safeString(input.title) ??
      safeString(input.query) ??
      safeString(input.task);

    if (taskId) {
      const task = await prisma.task.findFirst({
        where: {
          id: taskId,
          userId: env.runtime.userId,
        },
      });
      if (!task) {
        return {
          error: {
            success: false,
            error: "task_not_found",
            message: "I couldn't find that task.",
          } as ToolResult,
        };
      }
      return { task };
    }

    if (!taskTitle) {
      return {
        error: {
          success: false,
          error: "task_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "Which task should I reschedule?",
            missingFields: ["taskId or taskTitle"],
          },
        } as ToolResult,
      };
    }

    const tasks = await prisma.task.findMany({
      where: {
        userId: env.runtime.userId,
        title: { contains: taskTitle, mode: "insensitive" },
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
    });

    if (tasks.length === 0) {
      return {
        error: {
          success: false,
          error: "task_not_found",
          message: `I couldn't find a task matching "${taskTitle}".`,
        } as ToolResult,
      };
    }

    if (tasks.length > 1) {
      return {
        error: {
          success: false,
          error: "task_ambiguous",
          clarification: {
            kind: "resource",
            prompt: `I found multiple tasks matching "${taskTitle}". Please specify the exact task name or id.`,
            missingFields: ["taskId"],
          },
          data: tasks.map((task) => ({ id: task.id, title: task.title })),
        } as ToolResult,
      };
    }

    const [singleTask] = tasks;
    if (!singleTask) {
      return {
        error: {
          success: false,
          error: "task_not_found",
          message: `I couldn't find a task matching \"${taskTitle}\".`,
        },
      };
    }

    return {
      task: {
        id: singleTask.id,
        title: singleTask.title,
        durationMinutes: singleTask.durationMinutes,
        scheduledStart: singleTask.scheduledStart,
        scheduledEnd: singleTask.scheduledEnd,
      },
    };
  };

  return {
    async list(input) {
      try {
        const defaultTimeZone = await resolveDefaultCalendarTimeZone({
          userId: env.runtime.userId,
          emailAccountId: env.runtime.emailAccountId,
        });
        const timeZone = "error" in defaultTimeZone ? "UTC" : defaultTimeZone.timeZone;

        const limitRaw = typeof input.limit === "number" ? input.limit : undefined;
        const limit = typeof limitRaw === "number" && Number.isFinite(limitRaw)
          ? Math.min(100, Math.max(1, Math.trunc(limitRaw)))
          : 25;

        const dueRange =
          input.dueDateRange && typeof input.dueDateRange === "object" && !Array.isArray(input.dueDateRange)
            ? (input.dueDateRange as Record<string, unknown>)
            : input.dateRange && typeof input.dateRange === "object" && !Array.isArray(input.dateRange)
              ? (input.dateRange as Record<string, unknown>)
              : undefined;

        const afterRaw = safeString(dueRange?.after) ?? safeString(input.after);
        const beforeRaw = safeString(dueRange?.before) ?? safeString(input.before);
        const after = afterRaw ? parseDateBoundInTimeZone(afterRaw, timeZone, "start") : undefined;
        const before = beforeRaw ? parseDateBoundInTimeZone(beforeRaw, timeZone, "end") : undefined;

        const tasks = await prisma.task.findMany({
          where: {
            userId: env.runtime.userId,
            status: { notIn: ["COMPLETED", "CANCELLED"] },
            ...(after || before
              ? {
                  dueDate: {
                    ...(after ? { gte: after } : {}),
                    ...(before ? { lte: before } : {}),
                  },
                }
              : {}),
          },
          orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
          take: limit,
        });

        return {
          success: true,
          data: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            durationMinutes: task.durationMinutes,
            dueDate: task.dueDate?.toISOString() ?? null,
            scheduledStart: task.scheduledStart?.toISOString() ?? null,
            scheduledEnd: task.scheduledEnd?.toISOString() ?? null,
          })),
          message:
            tasks.length === 0
              ? "No matching tasks found."
              : `Found ${tasks.length} task${tasks.length === 1 ? "" : "s"}.`,
          meta: { resource: "task", itemCount: tasks.length },
        };
      } catch (error) {
        return taskFailure(error, "I couldn't list tasks right now.");
      }
    },

    async bulkReschedule(input) {
      try {
        const limitRaw = typeof input.limit === "number" ? input.limit : undefined;
        const limit = typeof limitRaw === "number" && Number.isFinite(limitRaw)
          ? Math.min(50, Math.max(1, Math.trunc(limitRaw)))
          : 20;

        const dueRange =
          input.dueDateRange && typeof input.dueDateRange === "object" && !Array.isArray(input.dueDateRange)
            ? (input.dueDateRange as Record<string, unknown>)
            : input.dateRange && typeof input.dateRange === "object" && !Array.isArray(input.dateRange)
              ? (input.dateRange as Record<string, unknown>)
              : undefined;

        const defaultTimeZone = await resolveDefaultCalendarTimeZone({
          userId: env.runtime.userId,
          emailAccountId: env.runtime.emailAccountId,
        });
        const timeZone = "error" in defaultTimeZone ? "UTC" : defaultTimeZone.timeZone;

        const afterRaw = safeString(dueRange?.after) ?? safeString(input.after);
        const beforeRaw = safeString(dueRange?.before) ?? safeString(input.before);
        const after = afterRaw ? parseDateBoundInTimeZone(afterRaw, timeZone, "start") : undefined;
        const before = beforeRaw ? parseDateBoundInTimeZone(beforeRaw, timeZone, "end") : undefined;

        const tasks = await prisma.task.findMany({
          where: {
            userId: env.runtime.userId,
            status: { notIn: ["COMPLETED", "CANCELLED"] },
            ...(after || before
              ? {
                  dueDate: {
                    ...(after ? { gte: after } : {}),
                    ...(before ? { lte: before } : {}),
                  },
                }
              : {}),
          },
          orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
          take: limit,
        });

        if (tasks.length === 0) {
          return {
            success: true,
            data: { rescheduled: 0, attempted: 0, results: [] },
            message: "No tasks matched that request.",
            meta: { resource: "task", itemCount: 0 },
          };
        }

        const windowStart = safeString(input.windowStart) ?? safeString(input.after) ?? safeString(input.start);
        const windowEnd = safeString(input.windowEnd) ?? safeString(input.before) ?? safeString(input.end);

        const results: Array<{ taskId: string; ok: boolean; error?: string; calendarEventId?: string | null }> = [];
        let rescheduled = 0;

        for (const task of tasks) {
          const result = await this.reschedule({
            taskId: task.id,
            changes: {
              ...(windowStart ? { after: windowStart } : {}),
              ...(windowEnd ? { before: windowEnd } : {}),
              updateCalendarEvent: true,
              createCalendarEvent: true,
              timeZone,
            },
          });
          if (result.success) {
            const data = result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : {};
            results.push({
              taskId: task.id,
              ok: true,
              calendarEventId: typeof data.calendarEventId === "string" ? data.calendarEventId : null,
            });
            rescheduled += 1;
          } else {
            results.push({
              taskId: task.id,
              ok: false,
              error: typeof result.error === "string" ? result.error : result.message,
            });
          }
        }

        return {
          success: rescheduled === tasks.length,
          data: {
            attempted: tasks.length,
            rescheduled,
            results,
          },
          message: `Rescheduled ${rescheduled} of ${tasks.length} task${tasks.length === 1 ? "" : "s"}.`,
          meta: { resource: "task", itemCount: rescheduled },
        };
      } catch (error) {
        return taskFailure(error, "I couldn't bulk reschedule tasks right now.");
      }
    },

    async reschedule(input) {
      try {
        const taskResult = await resolveTask(input);
        if ("error" in taskResult) return taskResult.error;

        const task = taskResult.task;
        const changes =
          input.changes && typeof input.changes === "object"
            ? (input.changes as Record<string, unknown>)
            : {};

        const defaultTimeZone = await resolveDefaultCalendarTimeZone({
          userId: env.runtime.userId,
          emailAccountId: env.runtime.emailAccountId,
        });
        if ("error" in defaultTimeZone) {
          return {
            success: false,
            error: "timezone_unavailable",
            message: defaultTimeZone.error,
          };
        }

        const requestedTimeZone =
          safeString(changes.timeZone) ?? safeString(changes.timezone);
        const resolvedTimeZone = resolveCalendarTimeZoneForRequest({
          requestedTimeZone,
          defaultTimeZone: defaultTimeZone.timeZone,
        });
        if ("error" in resolvedTimeZone) {
          return {
            success: false,
            error: "invalid_time_zone",
            message: resolvedTimeZone.error,
            clarification: {
              kind: "invalid_fields",
              prompt: "Please provide a valid IANA timezone, like America/Los_Angeles.",
              missingFields: ["timeZone"],
            },
          };
        }

        const explicitStartRaw = safeString(changes.start);
        const explicitEndRaw = safeString(changes.end);
        const explicitStart =
          explicitStartRaw != null
            ? parseDateBoundInTimeZone(
                explicitStartRaw,
                resolvedTimeZone.timeZone,
                "start",
              )
            : undefined;
        const explicitEnd =
          explicitEndRaw != null
            ? parseDateBoundInTimeZone(explicitEndRaw, resolvedTimeZone.timeZone, "end")
            : undefined;

        if ((explicitStartRaw && !explicitStart) || (explicitEndRaw && !explicitEnd)) {
          return {
            success: false,
            error: "invalid_reschedule_window",
            message:
              "I need valid start/end values to reschedule. Use ISO-8601 or local datetime.",
          };
        }

        const requestedDurationRaw =
          typeof changes.durationMinutes === "number"
            ? changes.durationMinutes
            : typeof changes.duration === "number"
              ? changes.duration
              : undefined;
        const requestedDurationMinutes =
          typeof requestedDurationRaw === "number" && Number.isFinite(requestedDurationRaw)
            ? Math.max(5, Math.min(24 * 60, Math.trunc(requestedDurationRaw)))
            : undefined;

        const durationMinutes = Math.max(5, requestedDurationMinutes ?? task.durationMinutes ?? 30);
        let start = explicitStart;
        let end = explicitEnd;

        if (!start || !end) {
          const afterRaw = safeString(changes.after) ?? safeString(changes.windowStart);
          const beforeRaw = safeString(changes.before) ?? safeString(changes.windowEnd);
          const parsedAfter =
            afterRaw != null
              ? parseDateBoundInTimeZone(afterRaw, resolvedTimeZone.timeZone, "start")
              : undefined;
          const parsedBefore =
            beforeRaw != null
              ? parseDateBoundInTimeZone(beforeRaw, resolvedTimeZone.timeZone, "end")
              : undefined;

          if ((afterRaw && !parsedAfter) || (beforeRaw && !parsedBefore)) {
            return {
              success: false,
              error: "invalid_reschedule_window",
              message:
                "I couldn't parse the reschedule window. Use ISO-8601 or local datetime values.",
            };
          }

          const windowStart =
            parsedAfter ??
            (task.scheduledEnd
              ? new Date(task.scheduledEnd.getTime() + 60 * 1000)
              : new Date(Date.now() + 60 * 1000));
          const windowEnd =
            parsedBefore ??
            new Date(windowStart.getTime() + defaultRescheduleWindowMs);

          const slots = await findCalendarAvailability(provider, {
            durationMinutes,
            start: windowStart,
            end: windowEnd,
          });

          if (slots.length === 0) {
            return {
              success: false,
              error: "no_valid_slot",
              message: "I couldn't find an available slot in that window.",
            };
          }

          const strategy =
            (safeString(changes.rescheduleStrategy) ?? safeString(changes.reschedule) ?? "next_available").toLowerCase();
          const selected = strategy.includes("later")
            ? [...slots].sort((a, b) => b.start.getTime() - a.start.getTime())[0]
            : [...slots].sort((a, b) => a.start.getTime() - b.start.getTime())[0];

          start = selected?.start;
          end = selected?.end;
        }

        if (!start && end) {
          start = new Date(end.getTime() - durationMinutes * 60_000);
        }

        if (start && !end) {
          end = new Date(start.getTime() + durationMinutes * 60_000);
        }

        if (!start || !end || start.getTime() >= end.getTime()) {
          return {
            success: false,
            error: "invalid_reschedule_window",
            message: "I couldn't determine a valid new time for that task.",
          };
        }

        const previousStart = task.scheduledStart;
        const previousEnd = task.scheduledEnd;

        await prisma.task.update({
          where: { id: task.id },
          data: {
            scheduledStart: start,
            scheduledEnd: end,
            isAutoScheduled: true,
            lastScheduled: new Date(),
            ...(requestedDurationMinutes !== undefined ? { durationMinutes: requestedDurationMinutes } : {}),
          },
        });

        const currentSchedule = await prisma.taskSchedule.findUnique({
          where: { taskId: task.id },
          select: {
            calendarId: true,
            calendarEventId: true,
          },
        });

        const shouldUpdateCalendar = asBoolean(changes.updateCalendarEvent) ?? true;
        const shouldCreateCalendarEvent = asBoolean(changes.createCalendarEvent) ?? false;

        let calendarUpdated = false;
        let calendarCreated = false;
        let linkedCalendarId: string | null = currentSchedule?.calendarId ?? null;
        let linkedCalendarEventId: string | null = currentSchedule?.calendarEventId ?? null;

        if (shouldUpdateCalendar && currentSchedule?.calendarEventId) {
          try {
            const updated = await updateCalendarEvent(provider, {
              calendarId: currentSchedule.calendarId ?? undefined,
              eventId: currentSchedule.calendarEventId,
              event: {
                start,
                end,
                timeZone: resolvedTimeZone.timeZone,
              },
            });
            linkedCalendarId = updated.calendarId ?? linkedCalendarId;
            linkedCalendarEventId = updated.id;
            calendarUpdated = true;
          } catch (error) {
            env.runtime.logger.warn("task.reschedule linked calendar update failed", {
              userId: env.runtime.userId,
              taskId: task.id,
              calendarId: currentSchedule.calendarId,
              calendarEventId: currentSchedule.calendarEventId,
              error,
            });
          }
        }

        if (shouldUpdateCalendar && !linkedCalendarEventId) {
          const searchStart = task.scheduledStart
            ? new Date(task.scheduledStart.getTime() - 24 * 60 * 60 * 1000)
            : new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
          const searchEnd = task.scheduledEnd
            ? new Date(task.scheduledEnd.getTime() + 24 * 60 * 60 * 1000)
            : new Date(end.getTime() + 7 * 24 * 60 * 60 * 1000);

          try {
            const events = await listCalendarEvents(provider, {
              query: task.title,
              start: searchStart,
              end: searchEnd,
            });

            const normalizedTitle = task.title.trim().toLowerCase();
            const ranked = [...events].sort((a, b) => {
              const aTitleExact = a.title.trim().toLowerCase() === normalizedTitle ? 1 : 0;
              const bTitleExact = b.title.trim().toLowerCase() === normalizedTitle ? 1 : 0;
              if (aTitleExact !== bTitleExact) return bTitleExact - aTitleExact;

              const aDistance = Math.abs(a.startTime.getTime() - (previousStart?.getTime() ?? start.getTime()));
              const bDistance = Math.abs(b.startTime.getTime() - (previousStart?.getTime() ?? start.getTime()));
              return aDistance - bDistance;
            });

            const candidate = ranked[0];
            if (candidate?.id) {
              const updated = await updateCalendarEvent(provider, {
                calendarId: candidate.calendarId,
                eventId: candidate.id,
                event: {
                  start,
                  end,
                  timeZone: resolvedTimeZone.timeZone,
                },
              });
              linkedCalendarId = updated.calendarId ?? candidate.calendarId ?? null;
              linkedCalendarEventId = updated.id;
              calendarUpdated = true;
            }
          } catch (error) {
            env.runtime.logger.warn("task.reschedule event discovery failed", {
              userId: env.runtime.userId,
              taskId: task.id,
              error,
            });
          }
        }

        if (shouldCreateCalendarEvent && !linkedCalendarEventId) {
          try {
            const created = await createCalendarEvent(provider, {
              calendarId: linkedCalendarId ?? undefined,
              event: {
                title: task.title,
                start,
                end,
                timeZone: resolvedTimeZone.timeZone,
              },
            });
            linkedCalendarId = created.calendarId ?? linkedCalendarId;
            linkedCalendarEventId = created.id;
            calendarCreated = true;
          } catch (error) {
            env.runtime.logger.warn("task.reschedule calendar event creation failed", {
              userId: env.runtime.userId,
              taskId: task.id,
              error,
            });
          }
        }

        await prisma.taskSchedule.upsert({
          where: { taskId: task.id },
          update: {
            scheduledStart: start,
            scheduledEnd: end,
            calendarId: linkedCalendarId,
            calendarEventId: linkedCalendarEventId,
          },
          create: {
            taskId: task.id,
            scheduledStart: start,
            scheduledEnd: end,
            calendarId: linkedCalendarId,
            calendarEventId: linkedCalendarEventId,
          },
        });

        const calendarLinkSummary = linkedCalendarEventId
          ? calendarCreated
            ? "Created and linked a calendar event for this task."
            : calendarUpdated
              ? "Updated the linked calendar event as well."
              : "Kept the existing calendar link for this task."
          : shouldUpdateCalendar
            ? "I couldn't find a linked calendar event for this task. Say \"also create a calendar block\" if you want one created."
            : "Calendar updates were skipped for this reschedule.";

        return {
          success: true,
          data: {
            taskId: task.id,
            title: task.title,
            previousStart: previousStart?.toISOString() ?? null,
            previousEnd: previousEnd?.toISOString() ?? null,
            newStart: start.toISOString(),
            newEnd: end.toISOString(),
            previousStartLocal: previousStart
              ? formatDateTimeForUser(previousStart, resolvedTimeZone.timeZone)
              : null,
            previousEndLocal: previousEnd
              ? formatDateTimeForUser(previousEnd, resolvedTimeZone.timeZone)
              : null,
            newStartLocal: formatDateTimeForUser(start, resolvedTimeZone.timeZone),
            newEndLocal: formatDateTimeForUser(end, resolvedTimeZone.timeZone),
            calendarId: linkedCalendarId,
            calendarEventId: linkedCalendarEventId,
            calendarUpdated,
            calendarCreated,
            timeZone: resolvedTimeZone.timeZone,
          },
          message: `Rescheduled "${task.title}". ${calendarLinkSummary}`,
          meta: { resource: "task", itemCount: 1 },
        };
      } catch (error) {
        return taskFailure(error, "I couldn't reschedule that task right now.");
      }
    },
  };
}
