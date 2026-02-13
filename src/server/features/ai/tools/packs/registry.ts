import { listCapabilityDefinitions } from "@/server/features/ai/capabilities/registry";
import type { ToolPackManifest } from "@/server/features/ai/tools/packs/manifest-schema";

export function listInternalToolPacks(): ToolPackManifest[] {
  return [
    {
      id: "core-inbox-calendar-policy",
      name: "Core Inbox Calendar Policy",
      enabled: true,
      dependencies: [],
      requiredFlags: [],
      capabilities: listCapabilityDefinitions().map((definition) => definition.id),
    },
  ];
}
