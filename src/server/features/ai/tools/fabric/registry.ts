import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";
import { loadToolPlugins } from "@/server/features/ai/tools/plugins/loader";
import { registerPluginTools } from "@/server/features/ai/tools/plugins/registry";
import { applyToolPolicyOverlay, type ToolPolicyOverlay } from "@/server/features/ai/tools/plugins/policy";

export function buildRuntimeToolRegistry(params?: {
  overlay?: ToolPolicyOverlay;
}): RuntimeToolDefinition[] {
  const plugins = loadToolPlugins();
  const registration = registerPluginTools(plugins);
  return applyToolPolicyOverlay(registration.tools, params?.overlay);
}

export function buildToolNameLookup(registry: RuntimeToolDefinition[]): Map<string, RuntimeToolDefinition> {
  return new Map(registry.map((definition) => [definition.toolName, definition]));
}
