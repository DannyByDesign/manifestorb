export type ToolProfileId = "minimal" | "coding" | "messaging" | "full";

export type ToolPolicyConfig = {
  allow?: string[];
  alsoAllow?: string[];
  deny?: string[];
  profile?: ToolProfileId | string;
};

export type ToolPolicyLike = {
  allow?: string[];
  deny?: string[];
};

export type RuntimePolicyByProvider = Record<string, ToolPolicyConfig>;
export type RuntimePolicyByAgent = Record<string, ToolPolicyConfig>;
export type RuntimePolicyByGroup = Record<string, ToolPolicyConfig>;

export interface RuntimeToolPolicyConfigEnvelope {
  profile?: ToolProfileId | string;
  allow?: string[];
  alsoAllow?: string[];
  deny?: string[];
  byProvider?: RuntimePolicyByProvider;
  byAgent?: RuntimePolicyByAgent;
  byGroup?: RuntimePolicyByGroup;
  sandbox?: ToolPolicyLike;
  subagent?: ToolPolicyLike;
}

export type ResolvedLayeredToolPolicies = {
  profilePolicy?: ToolPolicyLike;
  providerProfilePolicy?: ToolPolicyLike;
  globalPolicy?: ToolPolicyLike;
  globalProviderPolicy?: ToolPolicyLike;
  agentPolicy?: ToolPolicyLike;
  agentProviderPolicy?: ToolPolicyLike;
  groupPolicy?: ToolPolicyLike;
  sandboxPolicy?: ToolPolicyLike;
  subagentPolicy?: ToolPolicyLike;
  profile?: ToolProfileId | string;
  providerProfile?: ToolProfileId | string;
  profileAlsoAllow?: string[];
  providerProfileAlsoAllow?: string[];
};
