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

function isTruthyFlagValue(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function packFlagsEnabled(pack: ToolPackManifest): boolean {
  return pack.requiredFlags.every((flagName) =>
    isTruthyFlagValue(process.env[flagName]),
  );
}

export function loadRuntimeToolDefinitionsFromPacks(): RuntimeToolDefinition[] {
  const packs = listInternalToolPacks().map((pack) => toolPackManifestSchema.parse(pack));
  const enabledPacks = packs.filter(
    (pack) => pack.enabled && packFlagsEnabled(pack),
  );
  const enabledPackIds = new Set(enabledPacks.map((pack) => pack.id));
  for (const pack of enabledPacks) {
    for (const dependency of pack.dependencies) {
      if (!enabledPackIds.has(dependency)) {
        throw new Error(
          `missing_pack_dependency:pack=${pack.id}:dependency=${dependency}`,
        );
      }
    }
  }

  const out: RuntimeToolDefinition[] = [];
  const seenCapabilities = new Set<string>();
  const seenToolNames = new Map<string, string>();

  for (const pack of enabledPacks) {
    for (const capabilityId of pack.capabilities) {
      if (seenCapabilities.has(capabilityId)) continue;
      seenCapabilities.add(capabilityId);

      const definition = toRuntimeDefinition(capabilityId);
      const existingPack = seenToolNames.get(definition.toolName);
      if (existingPack) {
        throw new Error(
          `duplicate_runtime_tool_name:${definition.toolName}:packs=${existingPack},${pack.id}`,
        );
      }
      seenToolNames.set(definition.toolName, pack.id);
      out.push(definition);
    }
  }

  return out;
}
