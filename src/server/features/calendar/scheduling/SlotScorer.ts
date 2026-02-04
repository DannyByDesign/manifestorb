import { differenceInHours, differenceInMinutes } from "./date-utils";
import type {
  EnergyLevel,
  SchedulingSettings,
  SchedulingTask,
  SlotScore,
  TaskPriority,
  TimeSlot,
} from "./types";

interface ProjectTask {
  start: Date;
  end: Date;
}

export class SlotScorer {
  constructor(
    private settings: SchedulingSettings,
    private scheduledTasks: Map<string, ProjectTask[]> = new Map(),
  ) {}

  updateScheduledTasks(tasks: SchedulingTask[]) {
    this.scheduledTasks.clear();
    tasks.forEach((task) => {
      if (task.scheduledStart && task.scheduledEnd) {
        const projectId = "default";
        const projectTasks = this.scheduledTasks.get(projectId) || [];
        projectTasks.push({
          start: task.scheduledStart,
          end: task.scheduledEnd,
        });
        this.scheduledTasks.set(projectId, projectTasks);
      }
    });
  }

  scoreSlot(slot: TimeSlot, task: SchedulingTask): SlotScore {
    const factors = {
      workHourAlignment: this.scoreWorkHourAlignment(slot),
      energyLevelMatch: this.scoreEnergyLevelMatch(slot, task),
      projectProximity: this.scoreProjectProximity(slot),
      bufferAdequacy: this.scoreBufferAdequacy(slot),
      timePreference: this.scoreTimePreference(slot, task),
      deadlineProximity: this.scoreDeadlineProximity(slot, task),
      priorityScore: this.scorePriority(task),
    };

    const weights = {
      workHourAlignment: 1.0,
      energyLevelMatch: 1.5,
      projectProximity: 0.5,
      bufferAdequacy: 0.8,
      timePreference: 1.2,
      deadlineProximity: 3.0,
      priorityScore: 1.8,
    };

    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    const weightedSum = Object.entries(factors).reduce((sum, [key, value]) => {
      const weight = weights[key as keyof typeof weights];
      return sum + value * weight;
    }, 0);

    return {
      total: weightedSum / totalWeight,
      factors,
    };
  }

  private scoreWorkHourAlignment(slot: TimeSlot): number {
    return slot.isWithinWorkHours ? 1 : 0;
  }

  private scoreEnergyLevelMatch(slot: TimeSlot, task: SchedulingTask): number {
    if (!task.energyLevel) return 0.5;
    const slotEnergy = getEnergyLevelForTime(
      slot.start.getHours(),
      this.settings,
    );
    if (!slotEnergy) return 0.5;

    const energyLevels: EnergyLevel[] = ["HIGH", "MEDIUM", "LOW"];
    const taskIndex = energyLevels.indexOf(task.energyLevel);
    const slotIndex = energyLevels.indexOf(slotEnergy);
    const distance = Math.abs(taskIndex - slotIndex);
    return distance === 0 ? 1 : distance === 1 ? 0.5 : 0;
  }

  private scoreBufferAdequacy(slot: TimeSlot): number {
    return slot.hasBufferTime ? 1 : 0;
  }

  private scoreTimePreference(slot: TimeSlot, task: SchedulingTask): number {
    if (task.preferredTime) {
      const hour = slot.start.getHours();
      const preference = task.preferredTime.toLowerCase();
      const ranges = {
        morning: { start: 5, end: 12 },
        afternoon: { start: 12, end: 17 },
        evening: { start: 17, end: 22 },
      };
      const range = ranges[preference as keyof typeof ranges];
      return hour >= range.start && hour < range.end ? 1 : 0;
    }

    const minutesToSlot = differenceInMinutes(slot.start, new Date());
    const daysToSlot = minutesToSlot / (24 * 60);
    return Math.exp(-(Math.log(2) / 7) * daysToSlot);
  }

  private scoreDeadlineProximity(slot: TimeSlot, task: SchedulingTask): number {
    if (!task.dueDate) return 0.5;

    const now = new Date();
    const minutesOverdue = -differenceInMinutes(task.dueDate, now);

    if (minutesOverdue > 0) {
      const daysOverdue = minutesOverdue / (24 * 60);
      const maxOverdueScore = 2.0;
      const overdueScaleDays = 14;
      const baseScore = Math.min(
        maxOverdueScore,
        1.0 + daysOverdue / overdueScaleDays,
      );

      const minutesToSlot = differenceInMinutes(slot.start, now);
      const daysToSlot = minutesToSlot / (24 * 60);
      const timePenalty = Math.min(0.5, daysToSlot / 14);

      return baseScore * (1 - timePenalty);
    }

    const minutesToDeadline = differenceInMinutes(task.dueDate, slot.start);
    const daysToDeadline = minutesToDeadline / (24 * 60);
    return Math.min(0.99, Math.exp(-daysToDeadline / 3));
  }

  private scoreProjectProximity(slot: TimeSlot): number {
    if (!this.settings.groupByProject) return 0.5;

    const projectTasks = this.scheduledTasks.get("default");
    if (!projectTasks || projectTasks.length === 0) return 0.5;

    const hourDistances = projectTasks.map((projectTask) => {
      const distanceToStart = Math.abs(
        differenceInHours(slot.start, projectTask.start),
      );
      const distanceToEnd = Math.abs(
        differenceInHours(slot.end, projectTask.end),
      );
      return Math.min(distanceToStart, distanceToEnd);
    });

    const closestDistance = Math.min(...hourDistances);
    return Math.exp(-closestDistance / 4);
  }

  private scorePriority(task: SchedulingTask): number {
    if (!task.priority || task.priority === "NONE") return 0.25;
    const priority = task.priority as TaskPriority;
    switch (priority) {
      case "HIGH":
        return 1.0;
      case "MEDIUM":
        return 0.75;
      case "LOW":
        return 0.5;
      default:
        return 0.25;
    }
  }

  getScheduledTasks(): Map<string, ProjectTask[]> {
    return this.scheduledTasks;
  }
}

function getEnergyLevelForTime(
  hour: number,
  settings: SchedulingSettings,
): EnergyLevel | null {
  const workStart = settings.workHourStart;
  const workEnd = settings.workHourEnd;
  if (hour < workStart || hour >= workEnd) return null;

  const workDuration = workEnd - workStart;
  const third = Math.max(1, Math.floor(workDuration / 3));
  const offset = hour - workStart;

  if (offset < third) return "HIGH";
  if (offset < third * 2) return "MEDIUM";
  return "LOW";
}
