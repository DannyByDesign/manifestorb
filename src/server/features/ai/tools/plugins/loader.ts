import { listInternalToolPacks } from "@/server/features/ai/tools/packs/registry";
import { loadRuntimeToolDefinitionsFromPacks } from "@/server/features/ai/tools/packs/loader";
import type { ToolPlugin } from "@/server/features/ai/tools/plugins/types";

export function loadToolPlugins(): ToolPlugin[] {
  const packs = listInternalToolPacks();
  const definitions = loadRuntimeToolDefinitionsFromPacks();

  return packs.map((pack) => {
    const toolSet = new Set(pack.tools);
    return {
      id: pack.id,
      name: pack.name,
      precedence: pack.precedence,
      groups: pack.groups,
      tools: definitions.filter((definition) => toolSet.has(definition.toolName)),
    };
  });
}
