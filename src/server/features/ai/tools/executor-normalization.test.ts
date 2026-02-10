import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";
import { executeTool } from "./executor";
import type { ToolContext, ToolDefinition } from "./types";

vi.mock("server-only", () => ({}));

const { auditLogMock } = vi.hoisted(() => ({
  auditLogMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./security", () => ({
  checkPermissions: vi.fn().mockResolvedValue(undefined),
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  applyScopeLimits: vi.fn((_: string, params: unknown) => params),
}));

vi.mock("./audit", () => ({
  auditLog: auditLogMock,
}));

describe("executeTool result normalization", () => {
  const context: ToolContext = {
    userId: "user-1",
    emailAccountId: "email-1",
    logger: { error: vi.fn() },
    providers: {} as unknown as ToolContext["providers"],
  };

  beforeEach(() => {
    auditLogMock.mockClear();
  });

  it("normalizes top-level payload fields into data envelope", async () => {
    const tool: ToolDefinition<z.ZodTypeAny> = {
      name: "modify",
      description: "test",
      securityLevel: "CAUTION",
      parameters: z.object({
        resource: z.literal("task"),
      }),
      execute: vi.fn().mockResolvedValue({
        count: 3,
        updated: true,
      }),
    };

    const result = await executeTool(tool, { resource: "task" }, context);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      count: 3,
      updated: true,
    });
    expect(result.meta?.itemCount).toBe(3);
  });

  it("preserves explicit failures and audits them as failures", async () => {
    const tool: ToolDefinition<z.ZodTypeAny> = {
      name: "delete",
      description: "test",
      securityLevel: "CAUTION",
      parameters: z.object({
        resource: z.literal("email"),
      }),
      execute: vi.fn().mockResolvedValue({
        success: false,
        error: "Missing ids",
        clarification: {
          kind: "missing_fields",
          prompt: "Please provide which emails to delete.",
          missingFields: ["ids"],
        },
      }),
    };

    const result = await executeTool(tool, { resource: "email" }, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Missing ids");
    expect(result.message).toBe("Please provide which emails to delete.");
    expect(result.clarification?.kind).toBe("missing_fields");
    expect(auditLogMock).toHaveBeenCalled();
    const lastCallPayload = auditLogMock.mock.calls[auditLogMock.mock.calls.length - 1]?.[0] as { success?: boolean; error?: string };
    expect(lastCallPayload.success).toBe(false);
    expect(lastCallPayload.error).toBe("Missing ids");
  });
});
