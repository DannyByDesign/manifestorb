import { listToolDefinitions } from "@/server/features/ai/tools/runtime/capabilities/registry";

export function listMemoryPackTools(): string[] {
  return listToolDefinitions()
    .map((definition) => definition.id)
    .filter((name) => name.startsWith("memory."));
}
