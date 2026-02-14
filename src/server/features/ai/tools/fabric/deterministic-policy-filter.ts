import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";
import { filterToolsByPolicy } from "@/server/features/ai/tools/policy/policy-matcher";
import type { ResolvedLayeredToolPolicies } from "@/server/features/ai/tools/policy/types";

export interface DeterministicLayerCounts {
  afterProfile: number;
  afterProviderProfile: number;
  afterGlobal: number;
  afterGlobalProvider: number;
  afterAgent: number;
  afterAgentProvider: number;
  afterGroup: number;
  afterSandbox: number;
  afterSubagent: number;
}

export function applyDeterministicPolicyLayers(params: {
  registry: RuntimeToolDefinition[];
  layeredPolicies?: ResolvedLayeredToolPolicies;
  additionalGroups?: Record<string, string[]>;
}): { tools: RuntimeToolDefinition[]; counts: DeterministicLayerCounts } {
  const groups = params.additionalGroups;
  const layers = params.layeredPolicies;
  let working = [...params.registry];

  const counts: DeterministicLayerCounts = {
    afterProfile: working.length,
    afterProviderProfile: working.length,
    afterGlobal: working.length,
    afterGlobalProvider: working.length,
    afterAgent: working.length,
    afterAgentProvider: working.length,
    afterGroup: working.length,
    afterSandbox: working.length,
    afterSubagent: working.length,
  };

  if (!layers) {
    return { tools: working, counts };
  }

  const apply = (
    policy: typeof layers.profilePolicy,
    key: keyof DeterministicLayerCounts,
  ) => {
    working = policy ? filterToolsByPolicy(working, policy, groups) : working;
    counts[key] = working.length;
  };

  apply(layers.profilePolicy, "afterProfile");
  apply(layers.providerProfilePolicy, "afterProviderProfile");
  apply(layers.globalPolicy, "afterGlobal");
  apply(layers.globalProviderPolicy, "afterGlobalProvider");
  apply(layers.agentPolicy, "afterAgent");
  apply(layers.agentProviderPolicy, "afterAgentProvider");
  apply(layers.groupPolicy, "afterGroup");
  apply(layers.sandboxPolicy, "afterSandbox");
  apply(layers.subagentPolicy, "afterSubagent");

  return {
    tools: working,
    counts,
  };
}
