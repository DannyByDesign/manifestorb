import { describe, expect, it } from "vitest";
import { z } from "zod";
import { filterToolRegistry } from "@/server/features/ai/tools/fabric/policy-filter";
import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";

const baseSchema = z.object({}).strict();

function tool(params: {
  toolName: string;
  readOnly: boolean;
  riskLevel: "safe" | "caution" | "dangerous";
  families: RuntimeToolDefinition["metadata"]["intentFamilies"];
  tags: string[];
}): RuntimeToolDefinition {
  return {
    toolName: params.toolName,
    description: params.toolName,
    parameters: baseSchema,
    metadata: {
      id: params.toolName,
      description: params.toolName,
      inputSchema: baseSchema,
      outputSchema: z.unknown(),
      readOnly: params.readOnly,
      riskLevel: params.riskLevel,
      approvalOperation: "query",
      intentFamilies: params.families,
      tags: params.tags,
      effects: [
        {
          resource: "email",
          mutates: !params.readOnly,
        },
      ],
    },
    execute: async () => ({ success: true, data: [] }),
  };
}

const registry: RuntimeToolDefinition[] = [
  tool({
    toolName: "email.searchInbox",
    readOnly: true,
    riskLevel: "safe",
    families: ["inbox_read"],
    tags: ["email", "inbox", "search"],
  }),
  tool({
    toolName: "email.batchTrash",
    readOnly: false,
    riskLevel: "dangerous",
    families: ["inbox_mutate"],
    tags: ["email", "trash"],
  }),
  tool({
    toolName: "calendar.listEvents",
    readOnly: true,
    riskLevel: "safe",
    families: ["calendar_read"],
    tags: ["calendar", "events", "list"],
  }),
  tool({
    toolName: "calendar.deleteEvent",
    readOnly: false,
    riskLevel: "dangerous",
    families: ["calendar_mutate"],
    tags: ["calendar", "delete"],
  }),
  tool({
    toolName: "policy.setApproval",
    readOnly: false,
    riskLevel: "caution",
    families: ["calendar_policy"],
    tags: ["policy", "approval"],
  }),
  tool({
    toolName: "planner.planDay",
    readOnly: true,
    riskLevel: "safe",
    families: ["cross_surface_planning"],
    tags: ["planner", "schedule"],
  }),
];

describe("filterToolRegistry", () => {
  it("returns no tools for greeting/capability semantic intents", async () => {
    const filtered = await filterToolRegistry(registry, {
      message: "hello",
      turn: {
        intent: "greeting",
        domain: "general",
        requestedOperation: "meta",
        complexity: "simple",
        routeProfile: "fast",
        routeHint: "conversation_only",
        toolChoice: "none",
        knowledgeSource: "either",
        freshness: "low",
        riskLevel: "low",
        confidence: 0.99,
        toolHints: [],
        source: "compiler_fallback",
        conversationClauses: [],
        taskClauses: [],
        metaConstraints: [],
        needsClarification: false,
      },
    });

    expect(filtered).toEqual([]);
  });

  it("keeps inbox read tools and excludes unrelated domain tools", async () => {
    const filtered = await filterToolRegistry(registry, {
      message: "find the first email in my inbox",
      turn: {
        intent: "inbox_read",
        domain: "inbox",
        requestedOperation: "read",
        complexity: "simple",
        routeProfile: "fast",
        routeHint: "single_tool",
        toolChoice: "auto",
        knowledgeSource: "internal",
        freshness: "low",
        riskLevel: "low",
        confidence: 0.9,
        toolHints: ["group:inbox_read"],
        source: "compiler_fallback",
        conversationClauses: [],
        taskClauses: [],
        metaConstraints: [],
        needsClarification: false,
      },
      includeDangerous: false,
    });

    const names = filtered.map((definition) => definition.toolName);
    expect(names).toContain("email.searchInbox");
    expect(names).not.toContain("calendar.listEvents");
    expect(names).not.toContain("email.batchTrash");
  });

  it("allows dangerous tools only when semantic risk is high and includeDangerous is true", async () => {
    const filtered = await filterToolRegistry(registry, {
      message: "delete this calendar event",
      includeDangerous: true,
      turn: {
        intent: "calendar_mutation",
        domain: "calendar",
        requestedOperation: "mutate",
        complexity: "moderate",
        routeProfile: "standard",
        routeHint: "planner",
        toolChoice: "auto",
        knowledgeSource: "internal",
        freshness: "low",
        riskLevel: "high",
        confidence: 0.87,
        toolHints: ["group:calendar_mutate"],
        source: "compiler_fallback",
        conversationClauses: [],
        taskClauses: [],
        metaConstraints: [],
        needsClarification: false,
      },
    });

    const names = filtered.map((definition) => definition.toolName);
    expect(names).toContain("calendar.deleteEvent");
  });
});
