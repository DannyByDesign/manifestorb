import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeToolMock, requiresApprovalMock } = vi.hoisted(() => ({
  executeToolMock: vi.fn(),
  requiresApprovalMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./executor", () => ({
  executeTool: executeToolMock,
}));
vi.mock("./create", () => ({ createTool: { name: "create" } }));
vi.mock("./modify", () => ({ modifyTool: { name: "modify" } }));
vi.mock("./query", () => ({ queryTool: { name: "query" } }));
vi.mock("./delete", () => ({ deleteTool: { name: "delete" } }));
vi.mock("@/features/approvals/policy", () => ({
  requiresApproval: requiresApprovalMock,
}));

import { workflowTool } from "./workflow";

describe("workflowTool dependsOn chaining", () => {
  beforeEach(() => {
    executeToolMock.mockReset();
    requiresApprovalMock.mockReset();
  });

  it("normalizes step outputs with ids and item counts", async () => {
    requiresApprovalMock.mockResolvedValue(false);
    executeToolMock
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: "task-1" }, { id: "task-2" }],
      })
      .mockResolvedValueOnce({
        success: true,
        data: [],
      });

    const result = await workflowTool.execute(
      {
        steps: [{ action: "query", resource: "task", filter: { query: "x" } }, { action: "query", resource: "task", filter: { query: "y" } }],
        preApproved: true,
      },
      {} as any,
    );

    expect(result.data).toMatchObject({
      steps: expect.arrayContaining([
        expect.objectContaining({
          step: 0,
          success: true,
          outputIds: ["task-1", "task-2"],
          itemCount: 2,
        }),
      ]),
    });
  });

  it("infers ids from dependency output for delete/modify steps", async () => {
    requiresApprovalMock.mockResolvedValue(false);
    executeToolMock
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: "task-1" }, { id: "task-2" }],
      })
      .mockResolvedValueOnce({
        success: true,
        data: { count: 2 },
      });

    const result = await workflowTool.execute(
      {
        steps: [
          { action: "query", resource: "task", filter: { query: "old tasks" } },
          { action: "delete", resource: "task", dependsOn: 0 },
        ],
        preApproved: true,
      },
      {} as any,
    );

    expect(executeToolMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        resource: "task",
        ids: ["task-1", "task-2"],
      }),
      expect.anything(),
    );
    expect(result.success).toBe(true);
  });

  it("enforces nested step approval policy when workflow is not pre-approved", async () => {
    requiresApprovalMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    executeToolMock.mockResolvedValueOnce({
      success: true,
      data: [{ id: "task-1" }],
    });

    const result = await workflowTool.execute(
      {
        steps: [
          { action: "query", resource: "task", filter: { query: "x" } },
          { action: "delete", resource: "task", dependsOn: 0 },
        ],
      },
      { userId: "user-1" } as any,
    );

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({
      steps: expect.arrayContaining([
        expect.objectContaining({
          step: 1,
          success: false,
          error: expect.stringContaining("requires approval"),
        }),
      ]),
    });
    expect(executeToolMock).toHaveBeenCalledTimes(1);
  });

  it("returns deterministic compensation plan on partial failure", async () => {
    requiresApprovalMock.mockResolvedValue(false);
    executeToolMock
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: "task-1" }],
      })
      .mockResolvedValueOnce({
        success: false,
        error: "Boom",
      });

    const result = await workflowTool.execute(
      {
        steps: [
          { action: "create", resource: "task", data: { title: "Follow up" } },
          { action: "modify", resource: "task", ids: ["task-1"], changes: { status: "DONE" } },
        ],
        preApproved: true,
      },
      {} as any,
    );

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({
      compensation: {
        planned: [
          {
            sourceStep: 0,
            action: "delete",
            resource: "task",
            ids: ["task-1"],
          },
        ],
      },
    });
  });

  it("fails when dependsOn is invalid", async () => {
    requiresApprovalMock.mockResolvedValue(false);
    executeToolMock.mockReset();
    executeToolMock.mockResolvedValueOnce({
      success: true,
      data: [],
    });

    const result = await workflowTool.execute(
      {
        steps: [
          { action: "query", resource: "task", filter: { query: "x" } },
          { action: "delete", resource: "task", dependsOn: 2 },
        ],
        preApproved: true,
      },
      {} as any,
    );

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({
      steps: expect.arrayContaining([
        expect.objectContaining({
          step: 1,
          success: false,
          error: expect.stringContaining("Invalid dependsOn index"),
        }),
      ]),
    });
    expect(executeToolMock).toHaveBeenCalledTimes(1);
  });
});
