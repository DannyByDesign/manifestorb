import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { executeTool } from "./executor";
import type { ToolDefinition, ToolContext } from "./types";

vi.mock("server-only", () => ({}));

vi.mock("./security", () => ({
  checkPermissions: vi.fn().mockResolvedValue(undefined),
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  applyScopeLimits: vi.fn((_: string, params: unknown) => params),
}));

vi.mock("./audit", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

describe("executeTool metadata enrichment", () => {
  const context: ToolContext = {
    userId: "user-1",
    emailAccountId: "email-1",
    logger: { error: vi.fn() },
    providers: {} as any,
  };

  it("adds standard meta fields for array results", async () => {
    const tool: ToolDefinition<any> = {
      name: "query",
      description: "test",
      securityLevel: "SAFE",
      parameters: z.object({
        resource: z.literal("task"),
        ids: z.array(z.string()),
      }),
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: [{ id: "task-1" }, { id: "task-2" }],
      }),
    };

    const result = await executeTool(
      tool,
      { resource: "task", ids: ["task-1", "task-2"] },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.meta?.resource).toBe("task");
    expect(result.meta?.requestedIds).toEqual(["task-1", "task-2"]);
    expect(result.meta?.itemCount).toBe(2);
    expect(typeof result.meta?.durationMs).toBe("number");
  });

  it("uses count-based data objects for itemCount", async () => {
    const tool: ToolDefinition<any> = {
      name: "delete",
      description: "test",
      securityLevel: "CAUTION",
      parameters: z.object({
        resource: z.literal("task"),
        ids: z.array(z.string()),
      }),
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { count: 3 },
      }),
    };

    const result = await executeTool(
      tool,
      { resource: "task", ids: ["a", "b", "c"] },
      context,
    );

    expect(result.meta?.itemCount).toBe(3);
  });
});
