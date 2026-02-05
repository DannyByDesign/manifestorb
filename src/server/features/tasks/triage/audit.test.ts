import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTaskReadinessReport } from "./audit";
import prisma from "@/server/lib/__mocks__/prisma";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client");

describe("getTaskReadinessReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zero percentages when there are no open tasks", async () => {
    const taskCount = vi.mocked(prisma.task.count);
    for (let i = 0; i < 9; i += 1) {
      taskCount.mockResolvedValueOnce(0);
    }

    const report = await getTaskReadinessReport("user-1");

    expect(report.totalTasks).toBe(0);
    expect(report.openTasks).toBe(0);
    expect(report.percentages).toEqual({
      dueDate: 0,
      durationMinutes: 0,
      priority: 0,
      energyLevel: 0,
      preferredTime: 0,
      description: 0,
      unscheduledAutoTasks: 0,
    });
  });

  it("computes readiness percentages from open task counts", async () => {
    const taskCount = vi.mocked(prisma.task.count);
    taskCount
      .mockResolvedValueOnce(10) // totalTasks
      .mockResolvedValueOnce(5) // openTasks
      .mockResolvedValueOnce(2) // missing due date
      .mockResolvedValueOnce(1) // missing duration
      .mockResolvedValueOnce(3) // missing priority
      .mockResolvedValueOnce(1) // missing energy
      .mockResolvedValueOnce(0) // missing preferred time
      .mockResolvedValueOnce(2) // missing description
      .mockResolvedValueOnce(1); // unscheduled auto tasks

    const report = await getTaskReadinessReport("user-1");

    expect(report.missing).toEqual({
      dueDate: 2,
      durationMinutes: 1,
      priority: 3,
      energyLevel: 1,
      preferredTime: 0,
      description: 2,
      unscheduledAutoTasks: 1,
    });
    expect(report.percentages).toEqual({
      dueDate: 40,
      durationMinutes: 20,
      priority: 60,
      energyLevel: 20,
      preferredTime: 0,
      description: 40,
      unscheduledAutoTasks: 20,
    });
  });
});
