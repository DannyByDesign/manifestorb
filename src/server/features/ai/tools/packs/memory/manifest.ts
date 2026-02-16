import type { ToolPackManifest } from "@/server/features/ai/tools/packs/manifest-schema";
import { listMemoryPackTools } from "@/server/features/ai/tools/packs/memory/tools";

export function memoryToolPackManifest(): ToolPackManifest {
  const tools = listMemoryPackTools();

  return {
    id: "memory",
    name: "Memory Pack",
    enabled: true,
    dependencies: [],
    requiredFlags: [],
    precedence: 10,
    groups: ["group:memory"],
    tools,
  };
}
