import { describe, expect, it } from "vitest";
import { assertProviderFacingSchemaSafety } from "@/server/lib/llms/schema-safety";
import { listToolDefinitions } from "@/server/features/ai/tools/runtime/capabilities/registry";

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
});

