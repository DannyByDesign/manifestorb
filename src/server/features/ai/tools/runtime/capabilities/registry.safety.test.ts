import { describe, expect, it } from "vitest";
import { assertProviderFacingSchemaSafety } from "@/server/lib/llms/schema-safety";
import {
  getToolDefinition,
  listToolDefinitions,
} from "@/server/features/ai/tools/runtime/capabilities/registry";

describe("runtime capability input schemas", () => {
  it("are provider-safe for all runtime tools", () => {
    const definitions = listToolDefinitions();
    for (const definition of definitions) {
      expect(() =>
        assertProviderFacingSchemaSafety({
          schema: definition.inputSchema,
          label: `tool:${definition.id}`,
        }),
      ).not.toThrow();
    }
  });

  it("accepts query-based filters for sent email search", () => {
    const definition = getToolDefinition("email.search");
    const parsed = definition.inputSchema.safeParse({
      query: "portfolio review",
      purpose: "list",
      limit: 25,
      dateRange: { after: "2026-02-10", before: "2026-02-16" },
    });
    expect(parsed.success).toBe(true);
  });
});
