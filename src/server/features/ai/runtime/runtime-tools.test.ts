import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";
import { enforcePolicyForTool } from "@/server/features/ai/policy/enforcement";
import { assembleRuntimeSessionTools } from "@/server/features/ai/runtime/runtime-tools";
import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";

vi.mock("@/server/features/ai/policy/enforcement", () => ({
  enforcePolicyForTool: vi.fn(),
}));

function buildDefinition(): RuntimeToolDefinition {
  const parameters = z.object({ query: z.string().min(1) }).strict();
  return {
    toolName: "email.search",
    description: "Search inbox",
    parameters,
    metadata: {
      id: "email.search",
      description: "Search inbox",
      inputSchema: parameters,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["inbox_read"],
      tags: ["email", "inbox"],
      effects: [{ resource: "email", mutates: false }],
    },
    execute: async () => ({
      success: true,
      data: [{ id: "m-1" }],
      interactive: {
        type: "draft_created",
        summary: "draft ready",
        actions: [],
      },
    }),
  };
}

describe("runtime tools", () => {
  beforeEach(() => {
    vi.mocked(enforcePolicyForTool).mockReset();
  });

  it("executes allowed tools and records artifacts/summaries", async () => {
    vi.mocked(enforcePolicyForTool).mockResolvedValue({
      kind: "allow",
      args: { query: "latest" },
    });

    const artifacts = {
      approvals: [],
      interactivePayloads: [],
    };
    const summaries: Array<{
      toolName: string;
      outcome: "success" | "partial" | "blocked" | "failed";
      durationMs: number;
      result: unknown;
    }> = [];

    const { tools } = assembleRuntimeSessionTools({
      registry: [buildDefinition()],
      context: {
        policy: {
          userId: "u-1",
          emailAccountId: "acct-1",
          provider: "slack",
          source: "runtime",
        },
        capabilities: {} as never,
      },
      artifacts,
      summaries,
    });

    const result = await tools[0]!.execute({ query: "latest" });
    expect(result.success).toBe(true);
    expect(artifacts.interactivePayloads).toHaveLength(1);
    expect(artifacts.approvals).toHaveLength(0);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.toolName).toBe("email.search");
    expect(summaries[0]?.outcome).toBe("success");
  });

  it("returns blocked result and stores approval artifact when required", async () => {
    vi.mocked(enforcePolicyForTool).mockResolvedValue({
      kind: "require_approval",
      message: "Approval required",
      reasonCode: "approval_required",
      approval: {
        id: "approval-1",
      },
    });

    const artifacts = {
      approvals: [] as Array<{ id: string; requestPayload?: unknown }>,
      interactivePayloads: [] as unknown[],
    };
    const summaries: Array<{
      toolName: string;
      outcome: "success" | "partial" | "blocked" | "failed";
      durationMs: number;
      result: unknown;
    }> = [];

    const { tools } = assembleRuntimeSessionTools({
      registry: [buildDefinition()],
      context: {
        policy: {
          userId: "u-1",
          emailAccountId: "acct-1",
          provider: "slack",
          source: "runtime",
        },
        capabilities: {} as never,
      },
      artifacts,
      summaries,
    });

    const result = await tools[0]!.execute({ query: "latest" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("approval_required");
    expect(artifacts.approvals).toEqual([{ id: "approval-1" }]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.outcome).toBe("blocked");
  });
});
