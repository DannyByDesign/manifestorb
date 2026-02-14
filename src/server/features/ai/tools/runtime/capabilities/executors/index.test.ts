import { describe, expect, it } from "vitest";
import { listToolDefinitions } from "@/server/features/ai/tools/runtime/capabilities/registry";
import { resolveRuntimeToolExecutor } from "@/server/features/ai/tools/runtime/capabilities/executors";

describe("runtime tool executors", () => {
  it("provides an executor for every runtime tool definition", () => {
    const definitions = listToolDefinitions();
    for (const definition of definitions) {
      expect(() => resolveRuntimeToolExecutor(definition.id)).not.toThrow();
    }
  });
});
