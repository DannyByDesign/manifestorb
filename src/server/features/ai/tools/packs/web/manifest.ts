import type { ToolPackManifest } from "@/server/features/ai/tools/packs/manifest-schema";
import { listWebPackTools } from "@/server/features/ai/tools/packs/web/tools";

export function webToolPackManifest(): ToolPackManifest {
  const tools = listWebPackTools();

  return {
    id: "web",
    name: "Web Pack",
    enabled: true,
    dependencies: [],
    requiredFlags: [],
    precedence: 30,
    groups: ["group:web"],
    tools,
  };
}
