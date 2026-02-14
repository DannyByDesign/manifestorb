import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";
import { loadToolPlugins } from "@/server/features/ai/tools/plugins/loader";
import { registerPluginTools } from "@/server/features/ai/tools/plugins/registry";
import { applyToolPolicyOverlay, type ToolPolicyOverlay } from "@/server/features/ai/tools/plugins/policy";
import {
  buildPluginToolGroups,
  normalizeToolName,
  type PluginToolGroups,
} from "@/server/features/ai/tools/policy/tool-policy";

export interface RuntimeToolRegistryContext {
  registry: RuntimeToolDefinition[];
  pluginGroups: PluginToolGroups;
  additionalGroups: Record<string, string[]>;
}

function buildAdditionalGroups(pluginGroups: PluginToolGroups): Record<string, string[]> {
  const additionalGroups: Record<string, string[]> = {};
  for (const [group, tools] of pluginGroups.namedGroups.entries()) {
    additionalGroups[normalizeToolName(group)] = tools;
  }
  for (const [pluginId, tools] of pluginGroups.byPlugin.entries()) {
    additionalGroups[normalizeToolName(pluginId)] = tools;
  }
  return additionalGroups;
}

export function buildRuntimeToolRegistryContext(params?: {
  overlay?: ToolPolicyOverlay;
}): RuntimeToolRegistryContext {
  const plugins = loadToolPlugins();
  const registration = registerPluginTools(plugins);
  const registry = applyToolPolicyOverlay(registration.tools, params?.overlay);
  const pluginGroups = buildPluginToolGroups({
    plugins,
    registry,
  });

  return {
    registry,
    pluginGroups,
    additionalGroups: buildAdditionalGroups(pluginGroups),
  };
}

export function buildRuntimeToolRegistry(params?: {
  overlay?: ToolPolicyOverlay;
}): RuntimeToolDefinition[] {
  return buildRuntimeToolRegistryContext(params).registry;
}

export function buildToolNameLookup(registry: RuntimeToolDefinition[]): Map<string, RuntimeToolDefinition> {
  return new Map(registry.map((definition) => [definition.toolName, definition]));
}
