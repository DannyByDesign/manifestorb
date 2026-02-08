import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    task: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    taskSchedulingReason: {
      findMany: vi.fn(),
    },
    approvalRequest: {
      findMany: vi.fn(),
    },
  },
}));

const { getEmailAccountWithAiMock } = vi.hoisted(() => ({
  getEmailAccountWithAiMock: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  default: prismaMock,
}));

vi.mock("@/features/approvals/service", () => ({
  ApprovalService: class {
    async createRequest() {
      return { id: "approval-1" };
    }
    async decideRequest() {
      return { id: "decision-1" };
    }
  },
}));

vi.mock("@/features/email/provider", () => ({
  createEmailProvider: vi.fn(),
}));

vi.mock("@/features/reply-tracker/handle-conversation-status", () => ({
  updateThreadTrackers: vi.fn(),
}));

vi.mock("@/server/lib/user/get", () => ({
  getEmailAccountWithAi: getEmailAccountWithAiMock,
}));

vi.mock("@/features/calendar/scheduling/TaskSchedulingService", () => ({
  scheduleTasksForUser: vi.fn(),
}));

vi.mock("@/features/calendar/scheduling/date-utils", () => ({
  isAmbiguousLocalTime: vi.fn(() => false),
  resolveTimeZoneOrUtc: vi.fn((tz?: string) => ({ timeZone: tz ?? "UTC", isFallback: false })),
}));

import { queryTool } from "./query";
import { getTool } from "./get";
import { modifyTool } from "./modify";
import { deleteTool } from "./delete";

describe("task ownership scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes query task searches to the current user", async () => {
    prismaMock.task.findMany.mockResolvedValue([]);

    await queryTool.execute(
      { resource: "task", filter: { query: "roadmap", limit: 10 } },
      { userId: "user-1" } as any,
    );

    expect(prismaMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          OR: expect.any(Array),
        }),
      }),
    );
  });

  it("supports approval resource in query schema/dispatch", async () => {
    getEmailAccountWithAiMock.mockResolvedValue({ userId: "user-1" });
    prismaMock.approvalRequest.findMany.mockResolvedValue([]);

    const result = await queryTool.execute(
      { resource: "approval", filter: { status: "PENDING", limit: 5 } },
      { userId: "user-1", emailAccountId: "email-1", providers: {} } as any,
    );

    expect(prismaMock.approvalRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", status: "PENDING" },
        take: 5,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("scopes get task reads and reason lookups to the current user", async () => {
    prismaMock.task.findMany.mockResolvedValue([{ id: "task-1", title: "A" }]);
    prismaMock.taskSchedulingReason.findMany.mockResolvedValue([]);

    await getTool.execute(
      { resource: "task", ids: ["task-1"], includeReason: true },
      { userId: "user-1", providers: {} } as any,
    );

    expect(prismaMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["task-1"] }, userId: "user-1" },
      }),
    );
    expect(prismaMock.taskSchedulingReason.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          task: { userId: "user-1" },
        }),
      }),
    );
  });

  it("scopes modify task updates to the current user", async () => {
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.task.findMany.mockResolvedValue([{ id: "task-1", title: "Updated" }]);

    const result = await modifyTool.execute(
      {
        resource: "task",
        ids: ["task-1", "task-2"],
        changes: { title: "Updated" },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
        providers: {},
      } as any,
    );

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["task-1", "task-2"] }, userId: "user-1" },
      }),
    );
    expect(result.success).toBe(true);
  });

  it("scopes delete task operations to the current user", async () => {
    prismaMock.task.deleteMany.mockResolvedValue({ count: 1 });

    const result = await deleteTool.execute(
      { resource: "task", ids: ["task-1", "task-2"] },
      { userId: "user-1", providers: {} } as any,
    );

    expect(prismaMock.task.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["task-1", "task-2"] }, userId: "user-1" },
    });
    expect(result).toEqual({ success: true, data: { count: 1 } });
  });
});
