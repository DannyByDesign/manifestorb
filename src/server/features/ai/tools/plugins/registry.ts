import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";
import type { ToolPlugin, ToolPluginConflict } from "@/server/features/ai/tools/plugins/types";

export interface ToolRegistrationResult {
  tools: RuntimeToolDefinition[];
  conflicts: ToolPluginConflict[];
}

export function registerPluginTools(plugins: ToolPlugin[]): ToolRegistrationResult {
  const sorted = [...plugins].sort((a, b) => b.precedence - a.precedence);
  const byName = new Map<string, { pluginId: string; tool: RuntimeToolDefinition; precedence: number }>();
  const conflicts: ToolPluginConflict[] = [];

  for (const plugin of sorted) {
    for (const tool of plugin.tools) {
      const existing = byName.get(tool.toolName);
      if (!existing) {
        byName.set(tool.toolName, {
          pluginId: plugin.id,
          tool,
          precedence: plugin.precedence,
        });
        continue;
      }

      if (existing.precedence === plugin.precedence) {
        throw new Error(
          `duplicate_tool_with_same_precedence:${tool.toolName}:plugins=${existing.pluginId},${plugin.id}`,
        );
      }

      conflicts.push({
        toolName: tool.toolName,
        winnerPluginId: existing.precedence > plugin.precedence ? existing.pluginId : plugin.id,
        loserPluginId: existing.precedence > plugin.precedence ? plugin.id : existing.pluginId,
      });

      if (plugin.precedence > existing.precedence) {
        byName.set(tool.toolName, {
          pluginId: plugin.id,
          tool,
          precedence: plugin.precedence,
        });
      }
    }
  }

  return {
    tools: [...byName.values()].map((entry) => entry.tool),
    conflicts,
  };
}
