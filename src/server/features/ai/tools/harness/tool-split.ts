import type { RuntimeCustomToolDefinition, RuntimeToolHarness } from "@/server/features/ai/tools/harness/types";

export function splitSdkTools(options: {
  tools: RuntimeCustomToolDefinition[];
  sandboxEnabled: boolean;
}): RuntimeToolHarness {
  const { tools } = options;
  return {
    builtInTools: [],
    customTools: tools,
    toolLookup: new Map(tools.map((tool) => [tool.name, tool])),
  };
}
