import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import { addDays, resolveTimeZoneOrUtc } from "@/features/calendar/scheduling/date-utils";
import { getUnifiedCalendarAvailability } from "@/features/calendar/unified-availability";
import { ContextManager } from "@/features/memory/context-manager";

export type TaskTriageContext = {
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    durationMinutes: number | null;
    status: string;
    priority: string | null;
    energyLevel: string | null;
    preferredTime: string | null;
    dueDate: Date | null;
    startDate: Date | null;
    isAutoScheduled: boolean;
    scheduleLocked: boolean;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    scheduleScore: number | null;
    reschedulePolicy: string | null;
    lastScheduled: Date | null;
  }>;
  taskPreferences: {
    timeZone: string;
    workHourStart: number;
    workHourEnd: number;
    workDays: number[];
    bufferMinutes: number;
    groupByProject: boolean;
  } | null;
  schedulingReasons: Record<string, unknown>;
  recentCompletions: Array<{
    id: string;
    title: string;
    completedAt: Date;
  }>;
  availability: {
    windowStart: string;
    windowEnd: string;
    busyPeriods: Array<{ start: string; end: string }>;
  };
  memory: {
    summary?: string;
    facts: Array<{ key: string; value: string; confidence: number }>;
    knowledge: Array<{ title: string; content: string }>;
  };
};

export async function buildTaskTriageContext(params: {
  userId: string;
  emailAccountId: string;
  logger: Logger;
  messageContent?: string;
}): Promise<TaskTriageContext> {
  const { userId, emailAccountId, logger, messageContent } = params;

  const [tasks, taskPreference, schedulingReasons, recentCompletions, emailAccount] =
    await Promise.all([
      prisma.task.findMany({
        where: { userId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
      }),
      prisma.taskPreference.findUnique({ where: { userId } }),
      prisma.taskSchedulingReason.findMany({
        where: { task: { userId }, expiresAt: { gt: new Date() } },
        select: { taskId: true, reason: true },
      }),
      prisma.task.findMany({
        where: { userId, status: "COMPLETED" },
        orderBy: { updatedAt: "desc" },
        take: 25,
        select: { id: true, title: true, updatedAt: true },
      }),
      prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
      }),
    ]);

  if (!emailAccount) {
    throw new Error("Email account not found for task triage context");
  }

  const timeZone = resolveTimeZoneOrUtc(taskPreference?.timeZone).timeZone;
  const availabilityWindowStart = new Date();
  const availabilityWindowEnd = addDays(availabilityWindowStart, 7);
  const busyPeriods = await getUnifiedCalendarAvailability({
    emailAccountId,
    startDate: availabilityWindowStart,
    endDate: availabilityWindowEnd,
    timezone: timeZone,
    logger,
  });

  const schedulingReasonMap = schedulingReasons.reduce<Record<string, unknown>>(
    (acc, item) => {
      acc[item.taskId] = item.reason;
      return acc;
    },
    {},
  );

  const contextPack = await ContextManager.buildContextPack({
    user: { id: userId },
    emailAccount,
    messageContent: messageContent ?? "task triage",
  });

  return {
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      durationMinutes: task.durationMinutes,
      status: task.status,
      priority: task.priority,
      energyLevel: task.energyLevel,
      preferredTime: task.preferredTime,
      dueDate: task.dueDate,
      startDate: task.startDate,
      isAutoScheduled: task.isAutoScheduled,
      scheduleLocked: task.scheduleLocked,
      scheduledStart: task.scheduledStart,
      scheduledEnd: task.scheduledEnd,
      scheduleScore: task.scheduleScore,
      reschedulePolicy: task.reschedulePolicy,
      lastScheduled: task.lastScheduled,
    })),
    taskPreferences: taskPreference
      ? {
          timeZone,
          workHourStart: taskPreference.workHourStart,
          workHourEnd: taskPreference.workHourEnd,
          workDays: taskPreference.workDays,
          bufferMinutes: taskPreference.bufferMinutes,
          groupByProject: taskPreference.groupByProject,
        }
      : null,
    schedulingReasons: schedulingReasonMap,
    recentCompletions: recentCompletions.map((task) => ({
      id: task.id,
      title: task.title,
      completedAt: task.updatedAt,
    })),
    availability: {
      windowStart: availabilityWindowStart.toISOString(),
      windowEnd: availabilityWindowEnd.toISOString(),
      busyPeriods,
    },
    memory: {
      summary: contextPack.system.summary,
      facts: contextPack.facts.map((fact) => ({
        key: fact.key,
        value: fact.value,
        confidence: fact.confidence ?? 0.5,
      })),
      knowledge: contextPack.knowledge.map((entry) => ({
        title: entry.title,
        content: entry.content,
      })),
    },
  };
}
