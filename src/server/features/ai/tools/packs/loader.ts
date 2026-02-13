import { getCapabilityDefinition } from "@/server/features/ai/capabilities/registry";
import { listInternalToolPacks } from "@/server/features/ai/tools/packs/registry";
import {
  toolPackManifestSchema,
  type ToolPackManifest,
} from "@/server/features/ai/tools/packs/manifest-schema";
import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";

function capabilityIdToToolName(capabilityId: string): string {
  return capabilityId.replace(/[^a-zA-Z0-9_]/g, "__");
}

function toRuntimeDefinition(capabilityId: ToolPackManifest["capabilities"][number]): RuntimeToolDefinition {
  const definition = getCapabilityDefinition(capabilityId);
  return {
    toolName: capabilityIdToToolName(definition.id),
    capabilityId: definition.id,
    description: definition.description,
    parameters: definition.inputSchema,
    metadata: definition,
  };
}

export function loadRuntimeToolDefinitionsFromPacks(): RuntimeToolDefinition[] {
  const packs = listInternalToolPacks().map((pack) => toolPackManifestSchema.parse(pack));
  const enabledPacks = packs.filter((pack) => pack.enabled);

  const out: RuntimeToolDefinition[] = [];
  const seen = new Set<string>();

  for (const pack of enabledPacks) {
    for (const capabilityId of pack.capabilities) {
      if (seen.has(capabilityId)) continue;
      seen.add(capabilityId);
      out.push(toRuntimeDefinition(capabilityId));
    }
  }

  return out;
}
