import prisma from "@/server/db/client";

export type TaskReadinessReport = {
  totalTasks: number;
  openTasks: number;
  missing: {
    dueDate: number;
    durationMinutes: number;
    priority: number;
    energyLevel: number;
    preferredTime: number;
    description: number;
    unscheduledAutoTasks: number;
  };
  percentages: {
    dueDate: number;
    durationMinutes: number;
    priority: number;
    energyLevel: number;
    preferredTime: number;
    description: number;
    unscheduledAutoTasks: number;
  };
};

function toPercent(count: number, total: number) {
  if (total === 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

export async function getTaskReadinessReport(userId: string): Promise<TaskReadinessReport> {
  const totalTasks = await prisma.task.count({ where: { userId } });
  const openTasks = await prisma.task.count({
    where: { userId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
  });

  const baseWhere = { userId, status: { notIn: ["COMPLETED", "CANCELLED"] } };

  const [
    missingDueDate,
    missingDuration,
    missingPriority,
    missingEnergy,
    missingPreferredTime,
    missingDescription,
    unscheduledAutoTasks,
  ] = await Promise.all([
    prisma.task.count({ where: { ...baseWhere, dueDate: null } }),
    prisma.task.count({ where: { ...baseWhere, durationMinutes: null } }),
    prisma.task.count({
      where: {
        ...baseWhere,
        OR: [{ priority: null }, { priority: "NONE" }],
      },
    }),
    prisma.task.count({ where: { ...baseWhere, energyLevel: null } }),
    prisma.task.count({ where: { ...baseWhere, preferredTime: null } }),
    prisma.task.count({
      where: {
        ...baseWhere,
        OR: [{ description: null }, { description: "" }],
      },
    }),
    prisma.task.count({
      where: {
        ...baseWhere,
        isAutoScheduled: true,
        scheduledStart: null,
      },
    }),
  ]);

  return {
    totalTasks,
    openTasks,
    missing: {
      dueDate: missingDueDate,
      durationMinutes: missingDuration,
      priority: missingPriority,
      energyLevel: missingEnergy,
      preferredTime: missingPreferredTime,
      description: missingDescription,
      unscheduledAutoTasks,
    },
    percentages: {
      dueDate: toPercent(missingDueDate, openTasks),
      durationMinutes: toPercent(missingDuration, openTasks),
      priority: toPercent(missingPriority, openTasks),
      energyLevel: toPercent(missingEnergy, openTasks),
      preferredTime: toPercent(missingPreferredTime, openTasks),
      description: toPercent(missingDescription, openTasks),
      unscheduledAutoTasks: toPercent(unscheduledAutoTasks, openTasks),
    },
  };
}
