import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";

export interface ToolFilterParams {
  includeDangerous?: boolean;
}

export function filterToolRegistry(
  registry: RuntimeToolDefinition[],
  params: ToolFilterParams,
): RuntimeToolDefinition[] {
  if (params.includeDangerous) return registry;
  return registry.filter((tool) => tool.metadata.riskLevel !== "dangerous");
}
