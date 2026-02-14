import { getToolDefinition } from "@/server/features/ai/tools/runtime/capabilities/registry";
import { listInternalToolPacks } from "@/server/features/ai/tools/packs/registry";
import {
  toolPackManifestSchema,
  type ToolPackManifest,
} from "@/server/features/ai/tools/packs/manifest-schema";
import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";

function toRuntimeDefinition(toolName: ToolPackManifest["tools"][number]): RuntimeToolDefinition {
  const definition = getToolDefinition(toolName as Parameters<typeof getToolDefinition>[0]);
  return {
    toolName: definition.id,
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
  const seenToolNames = new Map<string, string>();

  for (const pack of enabledPacks) {
    for (const toolName of pack.tools) {
      const definition = toRuntimeDefinition(toolName);
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
