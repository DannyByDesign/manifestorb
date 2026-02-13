import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";

export interface ToolPolicyOverlay {
  allow?: string[];
  deny?: string[];
}

function matchesGroup(definition: RuntimeToolDefinition, entry: string): boolean {
  if (!entry.startsWith("group:")) return false;
  const normalizedGroup = entry.trim();
  const groups = definition.metadata.intentFamilies.map((family) => `group:${family}`);
  return groups.includes(normalizedGroup);
}

function matchesTool(definition: RuntimeToolDefinition, entry: string): boolean {
  return definition.toolName === entry;
}

function matches(definition: RuntimeToolDefinition, entry: string): boolean {
  return matchesTool(definition, entry) || matchesGroup(definition, entry);
}

export function applyToolPolicyOverlay(
  registry: RuntimeToolDefinition[],
  overlay?: ToolPolicyOverlay,
): RuntimeToolDefinition[] {
  if (!overlay) return registry;

  const denied = new Set(overlay.deny ?? []);
  const allowed = new Set(overlay.allow ?? []);
  const hasAllowList = allowed.size > 0;

  return registry.filter((definition) => {
    const deniedMatch = [...denied].some((entry) => matches(definition, entry));
    if (deniedMatch) return false;
    if (!hasAllowList) return true;
    return [...allowed].some((entry) => matches(definition, entry));
  });
}
