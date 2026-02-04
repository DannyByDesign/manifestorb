import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { addDays } from "./date-utils";
import { CalendarServiceImpl } from "./CalendarServiceImpl";
import type { TimeSlotManager } from "./TimeSlotManager";
import { TimeSlotManagerImpl } from "./TimeSlotManager";
import type { SchedulingSettings, SchedulingTask, TimeSlot } from "./types";

const DEFAULT_TASK_DURATION = 30;
const LOG_SOURCE = "SchedulingService";

export class SchedulingService {
  private calendarService: CalendarServiceImpl;
  private settings: SchedulingSettings;
  private logger = createScopedLogger(LOG_SOURCE);
  private userId: string;

  constructor(settings: SchedulingSettings, emailAccountId: string, userId: string) {
    this.calendarService = new CalendarServiceImpl(emailAccountId, this.logger);
    this.settings = settings;
    this.userId = userId;
  }

  private getTimeSlotManager(): TimeSlotManagerImpl {
    return new TimeSlotManagerImpl(this.settings, this.calendarService);
  }

  async scheduleMultipleTasks(
    tasks: SchedulingTask[],
  ): Promise<SchedulingTask[]> {
    if (tasks.length === 0) {
      return [];
    }
    const tasksToSchedule = tasks.filter(
      (t) => !t.scheduleLocked && t.reschedulePolicy !== "FIXED",
    );
    const timeSlotManager = this.getTimeSlotManager();
    const now = new Date();

    const initialScores = new Map<string, number>();
    const windows = [{ days: 7, label: "1 week" }];

    const batchSize = 8;
    for (let i = 0; i < tasksToSchedule.length; i += batchSize) {
      const batch = tasksToSchedule.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (task) => {
          let bestScore = 0;
          for (const window of windows) {
            const slots = await timeSlotManager.findAvailableSlots(
              task,
              now,
              addDays(now, window.days),
            );
            if (slots.length > 0) {
              bestScore = Math.max(bestScore, slots[0].score);
              break;
            }
          }
          return { taskId: task.id, score: bestScore };
        }),
      );
      batchResults.forEach((result) => {
        initialScores.set(result.taskId, result.score);
      });
    }

    const sortedTasks = [...tasksToSchedule].sort((a, b) => {
      const aScore = initialScores.get(a.id) || 0;
      const bScore = initialScores.get(b.id) || 0;
      return bScore - aScore;
    });

    const updatedTasks: SchedulingTask[] = [];

    for (const task of sortedTasks) {
      const taskWithDuration = {
        ...task,
        durationMinutes: task.durationMinutes || DEFAULT_TASK_DURATION,
      };

      const scheduledTask = await this.scheduleTask(
        taskWithDuration,
        timeSlotManager,
      );
      if (scheduledTask) {
        updatedTasks.push(scheduledTask);
      }
    }

    const finalTasks = await prisma.task.findMany({
      where: {
        id: {
          in: tasks.map((t) => t.id),
        },
        userId: tasks[0].userId,
      },
    });

    return finalTasks.map(mapDbTaskToSchedulingTask);
  }

  private async scheduleTask(
    task: SchedulingTask,
    timeSlotManager: TimeSlotManager,
  ): Promise<SchedulingTask | null> {
    const now = new Date();
    const windows = [{ days: 7, label: "1 week" }];

    for (const window of windows) {
      const endDate = addDays(now, window.days);
      const availableSlots = await timeSlotManager.findAvailableSlots(
        task,
        now,
        endDate,
      );

      if (availableSlots.length > 0) {
        const bestSlot = availableSlots[0];

        const updatedTask = await prisma.task.update({
          where: { id: task.id },
          data: {
            scheduledStart: bestSlot.start,
            scheduledEnd: bestSlot.end,
            isAutoScheduled: true,
            durationMinutes: task.durationMinutes || DEFAULT_TASK_DURATION,
            scheduleScore: bestSlot.score,
          },
        });

        await prisma.taskSchedulingReason.upsert({
          where: { taskId: task.id },
          create: {
            taskId: task.id,
            reason: buildSchedulingReason(task, bestSlot, window),
            expiresAt: addDays(new Date(), 30),
          },
          update: {
            reason: buildSchedulingReason(task, bestSlot, window),
            expiresAt: addDays(new Date(), 30),
          },
        });

        await timeSlotManager.addScheduledTaskConflict(
          mapDbTaskToSchedulingTask(updatedTask),
        );

        return mapDbTaskToSchedulingTask(updatedTask);
      }

      this.logger.info("No available slots in scheduling window", {
        windowLabel: window.label,
        taskId: task.id,
      });
    }

    return null;
  }
}

function buildSchedulingReason(
  task: SchedulingTask,
  slot: TimeSlot,
  window: { days: number; label: string },
) {
  return {
    windowLabel: window.label,
    windowDays: window.days,
    score: slot.score,
    withinWorkHours: slot.isWithinWorkHours,
    hasBufferTime: slot.hasBufferTime,
    conflictsCount: slot.conflicts.length,
    preferredTime: task.preferredTime ?? null,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    scheduledStart: slot.start.toISOString(),
    scheduledEnd: slot.end.toISOString(),
  };
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
  reschedulePolicy?: string | null;
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
