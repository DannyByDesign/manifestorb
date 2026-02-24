import { describe, expect, it } from "vitest";
import { z } from "zod";
import { filterToolRegistryDetailed } from "@/server/features/ai/tools/fabric/policy-filter";
import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";

const schema = z.object({}).strict();

function tool(params: {
  toolName: string;
  family: RuntimeToolDefinition["metadata"]["intentFamilies"][number];
  readOnly?: boolean;
  riskLevel?: "safe" | "caution" | "dangerous";
}): RuntimeToolDefinition {
  return {
    toolName: params.toolName,
    description: params.toolName,
    parameters: schema,
    metadata: {
      id: params.toolName,
      description: params.toolName,
      inputSchema: schema,
      outputSchema: z.unknown(),
      readOnly: params.readOnly ?? true,
      riskLevel: params.riskLevel ?? "safe",
      approvalOperation: "query",
      intentFamilies: [params.family],
      tags: [],
      effects: [{ resource: "email", mutates: !(params.readOnly ?? true) }],
    },
    execute: async () => ({ success: true }),
  };
}

const registry: RuntimeToolDefinition[] = [
  tool({ toolName: "email.search", family: "inbox_read", readOnly: true }),
  tool({ toolName: "email.batchTrash", family: "inbox_mutate", readOnly: false, riskLevel: "dangerous" }),
  tool({ toolName: "calendar.listEvents", family: "calendar_read", readOnly: true }),
];

describe("policy filter parity", () => {
  it("applies deterministic policies in layered intersection order", async () => {
    const result = await filterToolRegistryDetailed(registry, {
      message: "check inbox",
      turn: {
        intent: "inbox_read",
        domain: "inbox",
        requestedOperation: "read",
        complexity: "simple",
        routeProfile: "fast",
        routeHint: "planner",
        toolChoice: "auto",
        knowledgeSource: "internal",
        freshness: "low",
        riskLevel: "low",
        confidence: 0.9,
        toolHints: ["group:inbox_read"],
        source: "model",
        conversationClauses: [],
        taskClauses: [],
        metaConstraints: [],
        needsClarification: false,
        followUpLikely: false,
      },
      layeredPolicies: {
        profilePolicy: { allow: ["email.*"] },
        providerProfilePolicy: { allow: ["email.search", "email.batchTrash"] },
        globalPolicy: { deny: ["email.batchTrash"] },
        globalProviderPolicy: undefined,
        agentPolicy: undefined,
        agentProviderPolicy: undefined,
        groupPolicy: undefined,
        sandboxPolicy: undefined,
        subagentPolicy: undefined,
      },
    });

    expect(result.tools.map((entry) => entry.toolName)).toEqual(["email.search"]);
    expect(result.diagnostics.counts.afterProfile).toBe(1);
    expect(result.diagnostics.counts.afterProviderProfile).toBe(1);
    expect(result.diagnostics.counts.afterGlobal).toBe(1);
  });
});
