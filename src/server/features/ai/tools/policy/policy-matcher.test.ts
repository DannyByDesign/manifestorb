import { describe, expect, it } from "vitest";
import { z } from "zod";
import { filterToolsByPolicy, isToolAllowedByPolicies } from "@/server/features/ai/tools/policy/policy-matcher";
import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";

const schema = z.object({}).strict();

function tool(name: string): RuntimeToolDefinition {
  return {
    toolName: name,
    description: name,
    parameters: schema,
    metadata: {
      id: name,
      description: name,
      inputSchema: schema,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["inbox_read"],
      tags: [],
      effects: [{ resource: "email", mutates: false }],
    },
    execute: async () => ({ success: true }),
  };
}

describe("policy matcher", () => {
  it("supports wildcard and exact patterns", () => {
    const tools = [tool("email.searchInbox"), tool("calendar.listEvents"), tool("email.batchTrash")];
    const filtered = filterToolsByPolicy(
      tools,
      {
        allow: ["email.*"],
      },
      undefined,
    );
    expect(filtered.map((entry) => entry.toolName)).toEqual([
      "email.searchInbox",
      "email.batchTrash",
    ]);
  });

  it("applies deny before allow", () => {
    const tools = [tool("email.searchInbox"), tool("email.batchTrash")];
    const filtered = filterToolsByPolicy(
      tools,
      {
        allow: ["email.*"],
        deny: ["email.batchTrash"],
      },
      undefined,
    );
    expect(filtered.map((entry) => entry.toolName)).toEqual(["email.searchInbox"]);
  });

  it("expands dynamic groups passed from plugin/runtime group maps", () => {
    const tools = [tool("calendar.listEvents"), tool("calendar.deleteEvent"), tool("email.searchInbox")];
    const filtered = filterToolsByPolicy(
      tools,
      {
        allow: ["group:calendar"],
      },
      {
        "group:calendar": ["calendar.listEvents", "calendar.deleteEvent"],
      },
    );
    expect(filtered.map((entry) => entry.toolName)).toEqual([
      "calendar.listEvents",
      "calendar.deleteEvent",
    ]);
  });

  it("evaluates all layered policies as intersection", () => {
    const allowed = isToolAllowedByPolicies(
      "email.searchInbox",
      [
        { allow: ["email.*"] },
        { deny: ["email.batchTrash"] },
      ],
    );
    const denied = isToolAllowedByPolicies(
      "email.batchTrash",
      [
        { allow: ["email.*"] },
        { deny: ["email.batchTrash"] },
      ],
    );
    expect(allowed).toBe(true);
    expect(denied).toBe(false);
  });
});
