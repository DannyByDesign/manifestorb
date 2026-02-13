import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";
import { loadRuntimeToolDefinitionsFromPacks } from "@/server/features/ai/tools/packs/loader";

export function buildRuntimeToolRegistry(): RuntimeToolDefinition[] {
  return loadRuntimeToolDefinitionsFromPacks();
}

export function buildToolNameLookup(registry: RuntimeToolDefinition[]): Map<string, RuntimeToolDefinition> {
  return new Map(registry.map((definition) => [definition.toolName, definition]));
}
