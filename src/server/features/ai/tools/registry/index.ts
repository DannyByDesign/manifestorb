import type { ToolContract } from "@/server/features/ai/tools/contracts/tool-contract";

export class ToolRegistry {
  private readonly byName = new Map<string, ToolContract>();

  register(tool: ToolContract) {
    if (!tool.name || tool.name.trim().length === 0) {
      throw new Error("tool_registry_invalid_name");
    }
    if (this.byName.has(tool.name)) {
      throw new Error(`tool_registry_duplicate_name:${tool.name}`);
    }
    this.byName.set(tool.name, tool);
  }

  get(name: string): ToolContract | undefined {
    return this.byName.get(name);
  }

  list(): ToolContract[] {
    return [...this.byName.values()];
  }
}

export function buildToolRegistry(tools: ToolContract[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of tools) {
    registry.register(tool);
  }
  return registry;
}
