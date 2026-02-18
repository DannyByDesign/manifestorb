import type { RuntimeTurnContract } from "@/server/features/ai/runtime/turn-contract";
import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";
import { applyDeterministicPolicyLayers } from "@/server/features/ai/tools/fabric/deterministic-policy-filter";
import {
  rankAndLimitToolsAsync,
  selectSemanticToolCandidates,
} from "@/server/features/ai/tools/fabric/semantic-tool-candidate";
import type { ResolvedLayeredToolPolicies } from "@/server/features/ai/tools/policy/types";

export interface ToolFilterParams {
  includeDangerous?: boolean;
  message?: string;
  embeddingEmail?: string;
  strictReadOnly?: boolean;
  turn?: RuntimeTurnContract;
  maxTools?: number;
  layeredPolicies?: ResolvedLayeredToolPolicies;
  additionalGroups?: Record<string, string[]>;
}

export interface ToolFilterDiagnostics {
  counts: {
    before: number;
    semanticCandidate: number;
    afterProfile: number;
    afterProviderProfile: number;
    afterGlobal: number;
    afterGlobalProvider: number;
    afterAgent: number;
    afterAgentProvider: number;
    afterGroup: number;
    afterSandbox: number;
    afterSubagent: number;
    afterRisk: number;
    afterLimit: number;
  };
}

export async function filterToolRegistryDetailed(
  registry: RuntimeToolDefinition[],
  params: ToolFilterParams,
): Promise<{ tools: RuntimeToolDefinition[]; diagnostics: ToolFilterDiagnostics }> {
  const semanticCandidates = selectSemanticToolCandidates(registry, {
    turn: params.turn,
    strictReadOnly: params.strictReadOnly,
  });

  const deterministic = applyDeterministicPolicyLayers({
    registry: semanticCandidates,
    layeredPolicies: params.layeredPolicies,
    additionalGroups: params.additionalGroups,
  });

  const ranked = await rankAndLimitToolsAsync(deterministic.tools, {
    includeDangerous: params.includeDangerous,
    maxTools: params.maxTools,
    message: params.message,
    embeddingEmail: params.embeddingEmail,
    turn: params.turn,
  });

  return {
    tools: ranked.tools,
    diagnostics: {
      counts: {
        before: registry.length,
        semanticCandidate: semanticCandidates.length,
        afterProfile: deterministic.counts.afterProfile,
        afterProviderProfile: deterministic.counts.afterProviderProfile,
        afterGlobal: deterministic.counts.afterGlobal,
        afterGlobalProvider: deterministic.counts.afterGlobalProvider,
        afterAgent: deterministic.counts.afterAgent,
        afterAgentProvider: deterministic.counts.afterAgentProvider,
        afterGroup: deterministic.counts.afterGroup,
        afterSandbox: deterministic.counts.afterSandbox,
        afterSubagent: deterministic.counts.afterSubagent,
        afterRisk: ranked.afterRisk,
        afterLimit: ranked.afterLimit,
      },
    },
  };
}

export async function filterToolRegistry(
  registry: RuntimeToolDefinition[],
  params: ToolFilterParams,
): Promise<RuntimeToolDefinition[]> {
  return (await filterToolRegistryDetailed(registry, params)).tools;
}
