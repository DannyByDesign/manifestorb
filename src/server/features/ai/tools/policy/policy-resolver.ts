import type {
  ResolvedLayeredToolPolicies,
  ToolPolicyConfig,
  ToolPolicyLike,
} from "@/server/features/ai/tools/policy/types";
import { resolveToolProfilePolicy } from "@/server/features/ai/tools/policy/tool-policy";

const DEFAULT_SUBAGENT_TOOL_DENY = [
  "sessions_list",
  "sessions_history",
  "sessions_send",
  "sessions_spawn",
  "gateway",
  "agents_list",
  "whatsapp_login",
  "session_status",
  "cron",
  "memory_search",
  "memory_get",
  "memory.remember",
  "memory.recall",
  "memory.forget",
  "memory.list",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return out.length > 0 ? out : undefined;
}

function normalizeProviderKey(value: string): string {
  return value.trim().toLowerCase();
}

function unionAllow(base?: string[], extra?: string[]): string[] | undefined {
  if (!Array.isArray(extra) || extra.length === 0) return base;
  if (!Array.isArray(base) || base.length === 0) {
    return Array.from(new Set(["*", ...extra]));
  }
  return Array.from(new Set([...base, ...extra]));
}

function mergeAlsoAllow(
  policy: ToolPolicyLike | undefined,
  alsoAllow?: string[],
): ToolPolicyLike | undefined {
  if (!policy?.allow || !Array.isArray(alsoAllow) || alsoAllow.length === 0) return policy;
  return {
    ...policy,
    allow: Array.from(new Set([...policy.allow, ...alsoAllow])),
  };
}

function parseToolPolicyConfig(value: unknown): ToolPolicyConfig | undefined {
  if (!isRecord(value)) return undefined;
  const allow = asStringArray(value.allow);
  const alsoAllow = asStringArray(value.alsoAllow);
  const deny = asStringArray(value.deny);
  const profile = typeof value.profile === "string" && value.profile.trim() ? value.profile.trim() : undefined;
  if (!allow && !alsoAllow && !deny && !profile) return undefined;
  return {
    allow,
    alsoAllow,
    deny,
    profile,
  };
}

function parsePolicyMap(value: unknown): Record<string, ToolPolicyConfig> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, ToolPolicyConfig> = {};
  for (const [key, entry] of Object.entries(value)) {
    const parsed = parseToolPolicyConfig(entry);
    if (!parsed) continue;
    const normalized = key.trim();
    if (!normalized) continue;
    out[normalized] = parsed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

type AgentPolicyEntry = {
  tools?: ToolPolicyConfig;
  byProvider?: Record<string, ToolPolicyConfig>;
};

function parseAgentPolicyMap(value: unknown): Record<string, AgentPolicyEntry> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, AgentPolicyEntry> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.trim();
    if (!normalized) continue;

    if (isRecord(entry) && ("tools" in entry || "byProvider" in entry)) {
      const tools = parseToolPolicyConfig(entry.tools);
      const byProvider = parsePolicyMap(entry.byProvider);
      if (!tools && !byProvider) continue;
      out[normalized] = { tools, byProvider };
      continue;
    }

    const direct = parseToolPolicyConfig(entry);
    if (!direct) continue;
    out[normalized] = { tools: direct };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseToolPolicyLike(value: unknown): ToolPolicyLike | undefined {
  if (!isRecord(value)) return undefined;
  const allow = asStringArray(value.allow);
  const deny = asStringArray(value.deny);
  if (!allow && !deny) return undefined;
  return { allow, deny };
}

function resolveSubagentToolPolicy(params: {
  policy: unknown;
  isSubagentSession?: boolean;
}): ToolPolicyLike | undefined {
  const parsed = parseToolPolicyLike(params.policy);
  if (!params.isSubagentSession) return parsed;

  const deny = Array.from(
    new Set([...(parsed?.deny ?? []), ...DEFAULT_SUBAGENT_TOOL_DENY]),
  );
  return {
    allow: parsed?.allow,
    deny,
  };
}

function pickToolPolicy(config?: ToolPolicyConfig): ToolPolicyLike | undefined {
  if (!config) return undefined;
  const allow = Array.isArray(config.allow)
    ? unionAllow(config.allow, config.alsoAllow)
    : Array.isArray(config.alsoAllow) && config.alsoAllow.length > 0
      ? unionAllow(undefined, config.alsoAllow)
      : undefined;
  const deny = Array.isArray(config.deny) ? config.deny : undefined;
  if (!allow && !deny) return undefined;
  return { allow, deny };
}

function resolveProviderToolPolicy(params: {
  byProvider?: Record<string, ToolPolicyConfig>;
  modelProvider?: string;
  modelId?: string;
}): ToolPolicyConfig | undefined {
  const provider = params.modelProvider?.trim();
  if (!provider || !params.byProvider) return undefined;
  const entries = Object.entries(params.byProvider);
  if (entries.length === 0) return undefined;

  const lookup = new Map<string, ToolPolicyConfig>();
  for (const [key, value] of entries) {
    const normalized = normalizeProviderKey(key);
    if (!normalized) continue;
    lookup.set(normalized, value);
  }

  const normalizedProvider = normalizeProviderKey(provider);
  const rawModelId = params.modelId?.trim().toLowerCase();
  const fullModelId =
    rawModelId && !rawModelId.includes("/") ? `${normalizedProvider}/${rawModelId}` : rawModelId;
  const candidates = [...(fullModelId ? [fullModelId] : []), normalizedProvider];

  for (const key of candidates) {
    const match = lookup.get(key);
    if (match) return match;
  }
  return undefined;
}

function resolveGroupToolPolicy(params: {
  byGroup?: Record<string, ToolPolicyConfig>;
  groupId?: string | null;
  groupChannel?: string | null;
  channelId?: string | null;
}): ToolPolicyConfig | undefined {
  const byGroup = params.byGroup;
  if (!byGroup) return undefined;
  const groupId = params.groupId?.trim();
  const groupChannel = params.groupChannel?.trim().toLowerCase();
  const channelId = params.channelId?.trim();

  const candidates = [
    groupId && groupChannel ? `${groupChannel}/${groupId}` : undefined,
    groupId && groupChannel ? `${groupChannel}:${groupId}` : undefined,
    groupId,
    channelId,
    "*",
  ].filter((value): value is string => Boolean(value && value.trim()));

  for (const key of candidates) {
    const match = byGroup[key];
    if (match) return match;
  }
  return undefined;
}

export interface RuntimePolicyResolverInput {
  toolProfile?: string | null;
  toolAllow?: string[] | null;
  toolAlsoAllow?: string[] | null;
  toolDeny?: string[] | null;
  toolByProvider?: unknown;
  toolByAgent?: unknown;
  toolByGroup?: unknown;
  toolSandboxPolicy?: unknown;
  toolSubagentPolicy?: unknown;
  isSubagentSession?: boolean;
}

export function resolveEffectiveToolPolicy(params: {
  config?: RuntimePolicyResolverInput | null;
  agentId?: string | null;
  modelProvider?: string;
  modelId?: string;
  groupId?: string | null;
  groupChannel?: string | null;
  channelId?: string | null;
}): ResolvedLayeredToolPolicies {
  const cfg = params.config;
  const globalTools: ToolPolicyConfig | undefined = cfg
    ? {
        profile: cfg.toolProfile ?? undefined,
        allow: cfg.toolAllow ?? undefined,
        alsoAllow: cfg.toolAlsoAllow ?? undefined,
        deny: cfg.toolDeny ?? undefined,
      }
    : undefined;

  const byProvider = parsePolicyMap(cfg?.toolByProvider);
  const byAgent = parseAgentPolicyMap(cfg?.toolByAgent);
  const byGroup = parsePolicyMap(cfg?.toolByGroup);

  const providerPolicy = resolveProviderToolPolicy({
    byProvider,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
  });

  const agentEntry =
    params.agentId && byAgent ? byAgent[params.agentId] : undefined;
  const agentTools = agentEntry?.tools;
  const agentByProvider = agentEntry?.byProvider;

  const agentProviderPolicy = resolveProviderToolPolicy({
    byProvider: agentByProvider,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
  });

  const groupPolicy = resolveGroupToolPolicy({
    byGroup,
    groupId: params.groupId,
    groupChannel: params.groupChannel,
    channelId: params.channelId,
  });

  const profile = globalTools?.profile;
  const providerProfile = agentProviderPolicy?.profile ?? providerPolicy?.profile;
  const profilePolicy = mergeAlsoAllow(
    resolveToolProfilePolicy(profile),
    Array.isArray(globalTools?.alsoAllow) ? globalTools?.alsoAllow : undefined,
  );
  const providerProfilePolicy = mergeAlsoAllow(
    resolveToolProfilePolicy(providerProfile),
    Array.isArray(agentProviderPolicy?.alsoAllow)
      ? agentProviderPolicy?.alsoAllow
      : Array.isArray(providerPolicy?.alsoAllow)
        ? providerPolicy?.alsoAllow
        : undefined,
  );

  return {
    globalPolicy: pickToolPolicy(globalTools),
    globalProviderPolicy: pickToolPolicy(providerPolicy),
    agentPolicy: pickToolPolicy(agentTools),
    agentProviderPolicy: pickToolPolicy(agentProviderPolicy),
    groupPolicy: pickToolPolicy(groupPolicy),
    sandboxPolicy: parseToolPolicyLike(cfg?.toolSandboxPolicy),
    subagentPolicy: resolveSubagentToolPolicy({
      policy: cfg?.toolSubagentPolicy,
      isSubagentSession: cfg?.isSubagentSession,
    }),
    profile,
    providerProfile,
    profilePolicy,
    providerProfilePolicy,
    profileAlsoAllow: Array.isArray(globalTools?.alsoAllow) ? globalTools.alsoAllow : undefined,
    providerProfileAlsoAllow: Array.isArray(agentProviderPolicy?.alsoAllow)
      ? agentProviderPolicy.alsoAllow
      : Array.isArray(providerPolicy?.alsoAllow)
        ? providerPolicy.alsoAllow
        : undefined,
  };
}
