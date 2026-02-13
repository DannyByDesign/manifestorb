import { listToolDefinitions } from "@/server/features/ai/tools/runtime/legacy/registry";
import type { ToolPackManifest } from "@/server/features/ai/tools/packs/manifest-schema";

export function policyToolPackManifest(): ToolPackManifest {
  const tools = listToolDefinitions()
    .map((definition) => definition.id)
    .filter((name) => name.startsWith("policy."));

  return {
    id: "policy",
    name: "Policy Pack",
    enabled: true,
    dependencies: [],
    requiredFlags: [],
    precedence: 20,
    groups: ["group:policy"],
    tools,
  };
}
