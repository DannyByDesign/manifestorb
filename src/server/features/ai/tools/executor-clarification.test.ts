import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { executeTool } from "./executor";
import type { ToolContext, ToolDefinition } from "./types";

vi.mock("server-only", () => ({}));

vi.mock("./security", () => ({
  checkPermissions: vi.fn().mockResolvedValue(undefined),
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  applyScopeLimits: vi.fn((_: string, params: unknown) => params),
}));

vi.mock("./audit", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

describe("executeTool clarification recovery", () => {
  const context: ToolContext = {
    userId: "user-1",
    emailAccountId: "email-1",
    logger: { error: vi.fn() },
    providers: {} as unknown as ToolContext["providers"],
  };

  it("returns a resource clarification for discriminated-union parse failures", async () => {
    const tool: ToolDefinition<z.ZodTypeAny> = {
      name: "create",
      description: "test",
      securityLevel: "CAUTION",
      parameters: z.discriminatedUnion("resource", [
        z.object({
          resource: z.literal("email"),
          data: z.object({ to: z.array(z.string()) }),
        }),
        z.object({
          resource: z.literal("calendar"),
          data: z.object({ title: z.string() }),
        }),
      ]),
      execute: vi.fn(),
    };

    const result = await executeTool(tool, {}, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid tool arguments.");
    expect(result.clarification?.kind).toBe("resource");
    expect(result.message).toContain("which resource");
  });

  it("returns missing-field clarification for required fields", async () => {
    const tool: ToolDefinition<z.ZodTypeAny> = {
      name: "create",
      description: "test",
      securityLevel: "CAUTION",
      parameters: z.object({
        resource: z.literal("email"),
        data: z.object({
          to: z.array(z.string()).min(1),
          subject: z.string().min(1),
        }),
      }),
      execute: vi.fn(),
    };

    const result = await executeTool(
      tool,
      { resource: "email", data: {} },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid tool arguments.");
    expect(result.clarification?.kind).toBe("missing_fields");
    expect(result.message).toContain("recipient email");
  });
});
