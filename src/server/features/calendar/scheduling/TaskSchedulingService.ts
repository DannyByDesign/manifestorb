import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { SchedulingService } from "./SchedulingService";
import type { SchedulingSettings, SchedulingTask } from "./types";
import { ApprovalService } from "@/features/approvals/service";
import { createDeterministicIdempotencyKey } from "@/server/lib/idempotency";
import type { Logger } from "@/server/lib/logger";
import { resolveTimeZoneOrUtc } from "./date-utils";
import { env } from "@/env";
import { resolveDefaultCalendarTimeZone } from "@/features/ai/tools/calendar-time";
import { applyTaskPreferencePatchForUser } from "@/features/preferences/service";
import { ensureCalendarSelectionInvariant } from "@/features/calendar/selection-invariant";

const LOG_SOURCE = "TaskSchedulingService";

export async function scheduleTasksForUser({
  userId,
  emailAccountId,
  source,
}: {
  userId: string;
  emailAccountId?: string;
  source?: "ai" | "webhook" | "reconcile" | "manual";
}): Promise<SchedulingTask[]> {
  const logger = createScopedLogger(LOG_SOURCE);

  try {
    if (!env.NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED) {
      logger.info("Scheduling disabled by feature flag", { userId, source });
      return [];
    }

    let userSettings = await prisma.taskPreference.findUnique({
      where: { userId },
      select: {
        workHourStart: true,
        workHourEnd: true,
        workDays: true,
        bufferMinutes: true,
        selectedCalendarIds: true,
        timeZone: true,
        groupByProject: true,
      },
    });

    if (!userSettings) {
      userSettings = await prisma.taskPreference.create({
        data: { userId },
        select: {
          workHourStart: true,
          workHourEnd: true,
          workDays: true,
          bufferMinutes: true,
          selectedCalendarIds: true,
          timeZone: true,
          groupByProject: true,
        },
      });
    }

    const tasksToSchedule = await prisma.task.findMany({
      where: {
        isAutoScheduled: true,
        scheduleLocked: false,
        status: {
          notIn: ["COMPLETED", "IN_PROGRESS"],
        },
        userId,
      },
    });

    const approvalRequiredTasks = tasksToSchedule.filter(
      (task) => task.reschedulePolicy === "APPROVAL_REQUIRED",
    );
    const flexibleTasks = tasksToSchedule.filter(
      (task) =>
        task.reschedulePolicy !== "APPROVAL_REQUIRED" &&
        task.reschedulePolicy !== "FIXED",
    );

    const lockedTasks = await prisma.task.findMany({
      where: {
        isAutoScheduled: true,
        scheduleLocked: true,
        status: {
          notIn: ["COMPLETED", "IN_PROGRESS"],
        },
        userId,
      },
    });

    const resolvedEmailAccountId = await resolveSchedulingEmailAccountId({
      userId,
      emailAccountId,
      selectedCalendarIds: userSettings.selectedCalendarIds,
      logger,
    });

    const invariant = await ensureCalendarSelectionInvariant({
      userId,
      emailAccountId: resolvedEmailAccountId,
      logger,
      source: "task_scheduling",
    });

    const defaultCalendarTimeZone = await resolveDefaultCalendarTimeZone({
      userId,
      emailAccountId: resolvedEmailAccountId,
    });
    if ("error" in defaultCalendarTimeZone) {
      throw new Error(defaultCalendarTimeZone.error);
    }

    const effectiveSelectedCalendarIds = (invariant.selectedCalendarIds ?? []).filter(Boolean);
    if (effectiveSelectedCalendarIds.length === 0) {
      logger.warn("No enabled calendars available for scheduling", {
        userId,
        emailAccountId: resolvedEmailAccountId,
      });
      return [];
    }
    let effectiveTimeZone = defaultCalendarTimeZone.timeZone;
    if (userSettings.timeZone) {
      const resolvedPreferenceTimeZone = resolveTimeZoneOrUtc(userSettings.timeZone);
      if (!resolvedPreferenceTimeZone.isFallback) {
        effectiveTimeZone = resolvedPreferenceTimeZone.timeZone;
      } else {
        logger.warn("Invalid time zone in task preferences; using calendar integration timezone", {
          userId,
          originalTimeZone: resolvedPreferenceTimeZone.original,
          resolvedTimeZone: defaultCalendarTimeZone.timeZone,
        });
      }
    }

    const settings: SchedulingSettings = {
      workHourStart: userSettings.workHourStart,
      workHourEnd: userSettings.workHourEnd,
      workDays: userSettings.workDays,
      bufferMinutes: userSettings.bufferMinutes,
      selectedCalendarIds: effectiveSelectedCalendarIds,
      timeZone: effectiveTimeZone,
      groupByProject: userSettings.groupByProject,
    };

    const schedulingService = new SchedulingService(
      settings,
      resolvedEmailAccountId,
      userId,
    );

    await prisma.task.updateMany({
      where: {
        id: {
          in: flexibleTasks.map((task) => task.id),
        },
        userId,
      },
      data: {
        scheduledStart: null,
        scheduledEnd: null,
        scheduleScore: null,
      },
    });

    if (approvalRequiredTasks.length > 0) {
      const proposedTasks = await schedulingService.scheduleMultipleTasks(
        approvalRequiredTasks.map(mapDbTaskToSchedulingTask),
      );
      const proposedById = new Map(proposedTasks.map((t) => [t.id, t]));
      await createRescheduleApprovals({
        tasks: approvalRequiredTasks.map((task) => {
          const proposed = proposedById.get(task.id);
          return {
            ...task,
            newStart: proposed?.scheduledStart ?? null,
            newEnd: proposed?.scheduledEnd ?? null,
          };
        }),
        userId,
      });
    }

    const updatedTasks = await schedulingService.scheduleMultipleTasks(
      [...flexibleTasks, ...lockedTasks].map(mapDbTaskToSchedulingTask),
    );

    await prisma.task.updateMany({
      where: {
        id: {
          in: updatedTasks.map((task) => task.id),
        },
      },
      data: {
        lastScheduled: new Date(),
      },
    });

    return updatedTasks;
  } catch (error) {
    logger.error("Error scheduling tasks", { error, userId });
    throw error;
  }
}

export async function getTaskSchedulingReason(taskId: string) {
  const reason = await prisma.taskSchedulingReason.findFirst({
    where: {
      taskId,
      expiresAt: { gt: new Date() },
    },
    select: {
      reason: true,
      expiresAt: true,
      updatedAt: true,
    },
  });
  return reason ?? null;
}

export async function cleanupExpiredSchedulingReasons() {
  const result = await prisma.taskSchedulingReason.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}

export async function resolveSchedulingEmailAccountId({
  userId,
  emailAccountId,
  selectedCalendarIds,
  logger,
}: {
  userId: string;
  emailAccountId?: string;
  selectedCalendarIds?: string[] | null;
  logger: Logger;
}): Promise<string> {
  if (emailAccountId) return emailAccountId;

  const selectedIds = (selectedCalendarIds ?? []).filter(Boolean);
  if (selectedIds.length > 0) {
    const calendars = await prisma.calendar.findMany({
      where: {
        calendarId: { in: selectedIds },
        isEnabled: true,
        connection: { isConnected: true },
      },
      select: {
        calendarId: true,
        connection: { select: { emailAccountId: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const validCalendarIds = new Set(calendars.map((calendar) => calendar.calendarId));
    const invalidCalendarIds = selectedIds.filter((id) => !validCalendarIds.has(id));
    if (invalidCalendarIds.length > 0) {
      logger.warn("Selected calendars are invalid or disconnected", {
        userId,
        invalidCalendarIds,
      });
      await applyTaskPreferencePatchForUser({
        userId,
        patch: {
          selectedCalendarIds: Array.from(validCalendarIds),
        },
      });
    }

    const distinctAccountIds = Array.from(
      new Set(calendars.map((calendar) => calendar.connection.emailAccountId)),
    );

    if (distinctAccountIds.length > 1) {
      const preferredAccount = await prisma.emailAccount.findFirst({
        where: { id: { in: distinctAccountIds }, userId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      logger.warn("Multiple email accounts found for selected calendars", {
        userId,
        selectedCalendarIds: selectedIds,
        emailAccountIds: distinctAccountIds,
        chosenEmailAccountId: preferredAccount?.id ?? null,
      });
      if (preferredAccount?.id) {
        return preferredAccount.id;
      }
    }

    if (distinctAccountIds[0]) {
      return distinctAccountIds[0];
    }

    if (calendars.length === 0) {
      logger.warn("Selected calendars resolved to no connected calendars", {
        userId,
        selectedCalendarIds: selectedIds,
      });
    }
  }

  const fallback = await prisma.emailAccount.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!fallback) {
    throw new Error("No email account available for scheduling");
  }

  return fallback.id;
}

function mapDbTaskToSchedulingTask(task: {
  id: string;
  userId: string;
  title: string;
  durationMinutes: number | null;
  status: string;
  priority: string | null;
  energyLevel: string | null;
  preferredTime: string | null;
  dueDate: Date | null;
  startDate: Date | null;
  scheduleLocked: boolean;
  isAutoScheduled: boolean;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  scheduleScore: number | null;
  reschedulePolicy: string | null;
}): SchedulingTask {
  return {
    id: task.id,
    userId: task.userId,
    title: task.title,
    durationMinutes: task.durationMinutes,
    status: task.status as SchedulingTask["status"],
    priority: task.priority as SchedulingTask["priority"],
    energyLevel: task.energyLevel as SchedulingTask["energyLevel"],
    preferredTime: task.preferredTime as SchedulingTask["preferredTime"],
    dueDate: task.dueDate,
    startDate: task.startDate,
    scheduleLocked: task.scheduleLocked,
    isAutoScheduled: task.isAutoScheduled,
    scheduledStart: task.scheduledStart,
    scheduledEnd: task.scheduledEnd,
    scheduleScore: task.scheduleScore,
    reschedulePolicy: task.reschedulePolicy as SchedulingTask["reschedulePolicy"],
  };
}

async function createRescheduleApprovals({
  tasks,
  userId,
}: {
  tasks: Array<{
    id: string;
    title: string;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    newStart?: Date | null;
    newEnd?: Date | null;
  }>;
  userId: string;
}) {
  if (!tasks.length) return;

  const approvalService = new ApprovalService(prisma);
  const { createInAppNotification } = await import("@/features/notifications/create");

  const taskSummaries = tasks.map((task, i) => ({
    index: i,
    taskId: task.id,
    title: task.title,
    currentStart: task.scheduledStart?.toISOString() ?? null,
    currentEnd: task.scheduledEnd?.toISOString() ?? null,
    newStart: task.newStart?.toISOString() ?? null,
    newEnd: task.newEnd?.toISOString() ?? null,
  }));

  const batchKey = createDeterministicIdempotencyKey(
    "reschedule-batch",
    userId,
    taskSummaries,
  );

  const approval = await approvalService.createRequest({
    userId,
    provider: "system",
    externalContext: { source: "task-scheduler" },
    requestPayload: {
      actionType: "batch_reschedule_tasks",
      description: `Reschedule ${tasks.length} task(s)`,
      args: { tasks: taskSummaries },
    },
    idempotencyKey: batchKey,
    expiresInSeconds: 3600,
  });

  const taskList = tasks
    .map((t) => {
      const newTime =
        t.newStart != null
          ? new Date(t.newStart).toLocaleString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
          : "TBD";
      return `- ${t.title} -> ${newTime}`;
    })
    .join("\n");

  await createInAppNotification({
    userId,
    title: `Reschedule ${tasks.length} task(s)?`,
    body: `The scheduler wants to move:\n${taskList}\n\nApprove all or deny.`,
    type: "approval",
    metadata: {
      approvalId: approval.id,
      taskCount: tasks.length,
      tasks: taskSummaries,
    },
    dedupeKey: `batch-reschedule-${approval.id}`,
  });
}
