import prisma from "@/server/db/client";
import { addDays, addMinutes, areIntervalsOverlapping, fromZonedTime, getDay, roundDateUp, setHours, setMinutes, toZonedTime } from "./date-utils";
import type { CalendarService } from "./CalendarService";
import { SlotScorer } from "./SlotScorer";
import type { Conflict, SchedulingSettings, SchedulingTask, TimeSlot } from "./types";

const FALLBACK_TASK_DURATION = 30;
const FALLBACK_BUFFER_MINUTES = 15;

async function getDefaultTaskDuration(userId: string): Promise<number> {
  const insights = await prisma.schedulingInsights.findUnique({
    where: { userId },
    select: { medianMeetingDurationMin: true },
  });
  return insights?.medianMeetingDurationMin ?? FALLBACK_TASK_DURATION;
}

async function getMinimumBuffer(userId: string): Promise<number> {
  const insights = await prisma.schedulingInsights.findUnique({
    where: { userId },
    select: { avgBufferMin: true },
  });
  return insights?.avgBufferMin ?? FALLBACK_BUFFER_MINUTES;
}

export interface TimeSlotManager {
  findAvailableSlots(
    task: SchedulingTask,
    startDate: Date,
    endDate: Date,
  ): Promise<TimeSlot[]>;

  isSlotAvailable(slot: TimeSlot, userId: string): Promise<boolean>;

  calculateBufferTimes(slot: TimeSlot): {
    beforeBuffer: TimeSlot;
    afterBuffer: TimeSlot;
  };

  updateScheduledTasks(userId: string): Promise<void>;

  addScheduledTaskConflict(task: SchedulingTask): Promise<void>;
}

export class TimeSlotManagerImpl implements TimeSlotManager {
  private slotScorer: SlotScorer;
  private timeZone: string;

  constructor(
    private settings: SchedulingSettings,
    private calendarService: CalendarService,
  ) {
    this.slotScorer = new SlotScorer(settings);
    this.timeZone = settings.timeZone;
  }

  async updateScheduledTasks(userId: string): Promise<void> {
    const scheduledTasks = await prisma.task.findMany({
      where: {
        isAutoScheduled: true,
        scheduledStart: { not: null },
        scheduledEnd: { not: null },
        userId,
      },
    });

    this.slotScorer.updateScheduledTasks(
      scheduledTasks.map((task) => ({
        id: task.id,
        userId: task.userId,
        title: task.title,
        durationMinutes: task.durationMinutes,
        status: task.status,
        priority: task.priority,
        energyLevel: task.energyLevel,
        preferredTime: task.preferredTime,
        dueDate: task.dueDate,
        startDate: task.startDate,
        scheduleLocked: task.scheduleLocked,
        isAutoScheduled: task.isAutoScheduled,
        scheduledStart: task.scheduledStart,
        scheduledEnd: task.scheduledEnd,
        scheduleScore: task.scheduleScore,
      })),
    );
  }

  async findAvailableSlots(
    task: SchedulingTask,
    startDate: Date,
    endDate: Date,
  ): Promise<TimeSlot[]> {
    if (this.slotScorer.getScheduledTasks().size === 0) {
      await this.updateScheduledTasks(task.userId);
    }

    if (task.startDate instanceof Date && task.startDate > endDate) {
      return [];
    }

    const effectiveStartDate =
      task.startDate instanceof Date && task.startDate > startDate
        ? task.startDate
        : startDate;

    const duration =
      task.durationMinutes ?? (await getDefaultTaskDuration(task.userId));
    const bufferMin = await getMinimumBuffer(task.userId);
    const potentialSlots = this.generatePotentialSlots(
      duration,
      effectiveStartDate,
      endDate,
      bufferMin,
    );

    const workHourSlots = this.filterByWorkHours(potentialSlots);
    const availableSlots = await this.removeConflicts(
      workHourSlots,
      task,
      task.userId,
    );
    const slotsWithBuffer = this.applyBufferTimes(availableSlots);
    const scoredSlots = this.scoreSlots(slotsWithBuffer, task);
    return this.sortByScore(scoredSlots);
  }

  async isSlotAvailable(slot: TimeSlot, userId: string): Promise<boolean> {
    if (!this.isWithinWorkHours(slot)) {
      return false;
    }

    const conflicts = await this.findCalendarConflicts(slot, userId);
    if (conflicts.length > 0) {
      return false;
    }

    if (this.hasInMemoryConflict(slot)) {
      return false;
    }

    return true;
  }

  calculateBufferTimes(slot: TimeSlot) {
    const bufferMinutes = this.settings.bufferMinutes;

    return {
      beforeBuffer: {
        start: addMinutes(slot.start, -bufferMinutes),
        end: slot.start,
        score: 0,
        conflicts: [],
        energyLevel: null,
        isWithinWorkHours: this.isWithinWorkHours({
          start: addMinutes(slot.start, -bufferMinutes),
          end: slot.start,
          score: 0,
          conflicts: [],
          energyLevel: null,
          isWithinWorkHours: false,
          hasBufferTime: false,
        }),
        hasBufferTime: false,
      },
      afterBuffer: {
        start: slot.end,
        end: addMinutes(slot.end, bufferMinutes),
        score: 0,
        conflicts: [],
        energyLevel: null,
        isWithinWorkHours: this.isWithinWorkHours({
          start: slot.end,
          end: addMinutes(slot.end, bufferMinutes),
          score: 0,
          conflicts: [],
          energyLevel: null,
          isWithinWorkHours: false,
          hasBufferTime: false,
        }),
        hasBufferTime: false,
      },
    };
  }

  private generatePotentialSlots(
    duration: number,
    startDate: Date,
    endDate: Date,
  ): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const MINIMUM_BUFFER_MINUTES = 15;

    const localStartDate = toZonedTime(startDate, this.timeZone);
    let localEndDate = toZonedTime(endDate, this.timeZone);
    const localNow = toZonedTime(new Date(), this.timeZone);

    let localCurrentStart = localStartDate;

    if (localStartDate.toDateString() === localNow.toDateString()) {
      localCurrentStart = addMinutes(localCurrentStart, MINIMUM_BUFFER_MINUTES);

      if (localCurrentStart.getHours() >= this.settings.workHourEnd) {
        localCurrentStart = addDays(
          setMinutes(setHours(localCurrentStart, this.settings.workHourStart), 0),
          1,
        );
      }
    } else {
      localCurrentStart = setMinutes(
        setHours(localCurrentStart, this.settings.workHourStart),
        0,
      );
    }

    localCurrentStart = roundDateUp(localCurrentStart);
    localEndDate = roundDateUp(localEndDate);

    while (localCurrentStart < localEndDate) {
      const slotEnd = addMinutes(localCurrentStart, duration);
      slots.push({
        start: fromZonedTime(new Date(localCurrentStart), this.timeZone),
        end: fromZonedTime(new Date(slotEnd), this.timeZone),
        score: 0,
        conflicts: [],
        energyLevel: null,
        isWithinWorkHours: false,
        hasBufferTime: false,
      });

      localCurrentStart = addMinutes(localCurrentStart, duration);
    }

    return slots;
  }

  private filterByWorkHours(slots: TimeSlot[]): TimeSlot[] {
    return slots.filter((slot) => {
      const localStart = toZonedTime(slot.start, this.timeZone);
      const localEnd = toZonedTime(slot.end, this.timeZone);

      const startHour = localStart.getHours();
      const endHour = localEnd.getHours();
      const dayOfWeek = localStart.getDay();

      const isWorkDay = this.settings.workDays.includes(dayOfWeek);
      const isWithinWorkHours =
        startHour >= this.settings.workHourStart &&
        endHour <= this.settings.workHourEnd &&
        startHour < this.settings.workHourEnd;

      if (isWorkDay && isWithinWorkHours) {
        slot.isWithinWorkHours = true;
      }

      return isWorkDay && isWithinWorkHours;
    });
  }

  private isWithinWorkHours(slot: TimeSlot): boolean {
    const localStart = toZonedTime(slot.start, this.timeZone);
    const localEnd = toZonedTime(slot.end, this.timeZone);

    const slotDay = getDay(localStart);
    if (!this.settings.workDays.includes(slotDay)) {
      return false;
    }

    const startHour = localStart.getHours();
    const endHour = localEnd.getHours();

    return (
      startHour >= this.settings.workHourStart &&
      endHour <= this.settings.workHourEnd &&
      startHour < this.settings.workHourEnd
    );
  }

  private async findCalendarConflicts(
    slot: TimeSlot,
    userId: string,
  ): Promise<Conflict[]> {
    if (this.settings.selectedCalendarIds.length === 0) {
      return [];
    }

    return this.calendarService.findConflicts(
      slot,
      this.settings.selectedCalendarIds,
      userId,
    );
  }

  private hasInMemoryConflict(slot: TimeSlot): boolean {
    for (const [, projectTasks] of this.slotScorer
      .getScheduledTasks()
      .entries()) {
      for (const projectTask of projectTasks) {
        if (
          areIntervalsOverlapping(
            { start: slot.start, end: slot.end },
            { start: projectTask.start, end: projectTask.end },
          )
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private async removeConflicts(
    slots: TimeSlot[],
    task: SchedulingTask,
    userId: string,
  ): Promise<TimeSlot[]> {
    const availableSlots: TimeSlot[] = [];

    const slotsToCheck = slots.map((slot) => ({
      slot,
      taskId: task.id,
    }));

    const batchResults = await this.calendarService.findBatchConflicts(
      slotsToCheck,
      this.settings.selectedCalendarIds,
      userId,
      task.id,
    );

    for (const result of batchResults) {
      if (!result || !result.slot) continue;

      if (result.conflicts.length === 0) {
        if (!this.hasInMemoryConflict(result.slot)) {
          availableSlots.push(result.slot);
        }
      } else {
        result.slot.conflicts = result.conflicts;
      }
    }

    return availableSlots;
  }

  private applyBufferTimes(slots: TimeSlot[]): TimeSlot[] {
    return slots.map((slot) => {
      const { beforeBuffer, afterBuffer } = this.calculateBufferTimes(slot);
      slot.hasBufferTime =
        beforeBuffer.isWithinWorkHours && afterBuffer.isWithinWorkHours;
      return slot;
    });
  }

  private scoreSlots(slots: TimeSlot[], task: SchedulingTask): TimeSlot[] {
    return slots.map((slot) => {
      const score = this.slotScorer.scoreSlot(slot, task);
      return {
        ...slot,
        score: score.total,
      };
    });
  }

  private sortByScore(slots: TimeSlot[]): TimeSlot[] {
    return [...slots].sort((a, b) => b.score - a.score);
  }

  async addScheduledTaskConflict(task: SchedulingTask): Promise<void> {
    if (task.scheduledStart && task.scheduledEnd) {
      const projectId = "default";
      const projectTasks =
        this.slotScorer.getScheduledTasks().get(projectId) || [];
      projectTasks.push({
        start: task.scheduledStart,
        end: task.scheduledEnd,
      });
      this.slotScorer.getScheduledTasks().set(projectId, projectTasks);
    }
  }
}
