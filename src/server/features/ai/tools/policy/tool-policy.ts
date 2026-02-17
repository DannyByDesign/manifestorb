import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";
import type { ToolPlugin } from "@/server/features/ai/tools/plugins/types";
import type { ToolPolicyLike, ToolProfileId } from "@/server/features/ai/tools/policy/types";

const TOOL_NAME_ALIASES: Record<string, string> = {
  "apply-patch": "apply_patch",
};

const TOOL_GROUPS: Record<string, string[]> = {
  "group:inbox_read": [
    "email.getUnreadCount",
    "email.searchThreads",
    "email.searchThreadsAdvanced",
    "email.searchSent",
    "email.searchInbox",
    "email.getThreadMessages",
    "email.getMessagesBatch",
    "email.getLatestMessage",
    "search.query",
    "email.listFilters",
    "email.listDrafts",
    "email.getDraft",
  ],
  "group:inbox_mutate": [
    "email.batchArchive",
    "email.batchTrash",
    "email.markReadUnread",
    "email.applyLabels",
    "email.removeLabels",
    "email.moveThread",
    "email.markSpam",
    "email.unsubscribeSender",
    "email.blockSender",
    "email.bulkSenderArchive",
    "email.bulkSenderTrash",
    "email.bulkSenderLabel",
    "email.snoozeThread",
  ],
  "group:inbox_compose": [
    "email.createDraft",
    "email.updateDraft",
    "email.deleteDraft",
    "email.sendDraft",
    "email.sendMessage",
  ],
  "group:calendar_read": [
    "calendar.listEvents",
    "calendar.findEvents",
    "calendar.getEvent",
    "calendar.getAvailability",
    "search.query",
  ],
  "group:calendar_mutate": [
    "calendar.createEvent",
    "calendar.updateEvent",
    "calendar.deleteEvent",
    "calendar.moveEvent",
    "calendar.rescheduleEvent",
    "task.reschedule",
    "calendar.bulkReschedule",
  ],
  "group:calendar_policy": [
    "policy.setApprovalPreference",
    "policy.setCalendarPolicy",
  ],
  "group:cross_surface_planning": [
    "planner.planDay",
    "planner.prioritizeWork",
    "search.query",
  ],
  "group:web": [
    "web.search",
    "web.fetch",
  ],
  "group:inbox": [
    "group:inbox_read",
    "group:inbox_mutate",
    "group:inbox_compose",
  ],
  "group:calendar": [
    "group:calendar_read",
    "group:calendar_mutate",
    "group:calendar_policy",
  ],
};

const TOOL_PROFILES: Record<ToolProfileId, ToolPolicyLike> = {
  minimal: {
    allow: ["group:inbox_read", "group:calendar_read"],
  },
  coding: {
    allow: ["*"],
  },
  messaging: {
    allow: ["group:inbox"],
  },
  full: {},
};

export type PluginToolGroups = {
  all: string[];
  byPlugin: Map<string, string[]>;
  namedGroups: Map<string, string[]>;
};

export type AllowlistResolution = {
  policy: ToolPolicyLike | undefined;
  unknownAllowlist: string[];
  strippedAllowlist: boolean;
};

export function normalizeToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

export function normalizeToolList(list?: string[]): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((value) => normalizeToolName(value)).filter(Boolean);
}

function resolveGroupMembers(
  groupName: string,
  registry: Record<string, string[]>,
  visited: Set<string>,
): string[] {
  if (visited.has(groupName)) return [];
  visited.add(groupName);

  const members = registry[groupName] ?? [];
  const expanded: string[] = [];
  for (const member of members) {
    if (member.startsWith("group:")) {
      expanded.push(...resolveGroupMembers(member, registry, visited));
      continue;
    }
    expanded.push(normalizeToolName(member));
  }
  return expanded;
}

export function expandToolGroups(
  list?: string[],
  additionalGroups?: Record<string, string[]>,
): string[] {
  const normalized = normalizeToolList(list);
  const registry: Record<string, string[]> = {
    ...TOOL_GROUPS,
    ...(additionalGroups ?? {}),
  };

  const expanded: string[] = [];
  for (const value of normalized) {
    if (!value.startsWith("group:")) {
      expanded.push(value);
      continue;
    }
    const groupMembers = resolveGroupMembers(value, registry, new Set<string>());
    if (groupMembers.length > 0) {
      expanded.push(...groupMembers);
      continue;
    }
    expanded.push(value);
  }
  return Array.from(new Set(expanded));
}

export function resolveToolProfilePolicy(profile?: string): ToolPolicyLike | undefined {
  if (!profile) return undefined;
  const resolved = TOOL_PROFILES[profile as ToolProfileId];
  if (!resolved) return undefined;
  if (!resolved.allow && !resolved.deny) return undefined;
  return {
    allow: resolved.allow ? [...resolved.allow] : undefined,
    deny: resolved.deny ? [...resolved.deny] : undefined,
  };
}

export function collectExplicitAllowlist(
  policies: Array<ToolPolicyLike | undefined>,
): string[] {
  const entries: string[] = [];
  for (const policy of policies) {
    if (!policy?.allow) continue;
    for (const value of policy.allow) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed) entries.push(trimmed);
    }
  }
  return entries;
}

export function buildPluginToolGroups(params: {
  plugins: ToolPlugin[];
  registry: RuntimeToolDefinition[];
}): PluginToolGroups {
  const byPlugin = new Map<string, string[]>();
  const namedGroups = new Map<string, string[]>();
  const all: string[] = [];

  for (const plugin of params.plugins) {
    const toolNames = plugin.tools
      .map((definition) => normalizeToolName(definition.toolName))
      .filter(Boolean);
    if (toolNames.length === 0) continue;

    byPlugin.set(normalizeToolName(plugin.id), [...toolNames]);
    all.push(...toolNames);

    for (const group of plugin.groups) {
      const key = normalizeToolName(group);
      const existing = namedGroups.get(key) ?? [];
      namedGroups.set(key, Array.from(new Set([...existing, ...toolNames])));
    }
  }

  for (const definition of params.registry) {
    const toolName = normalizeToolName(definition.toolName);
    for (const family of definition.metadata.intentFamilies) {
      const group = normalizeToolName(`group:${family}`);
      const existing = namedGroups.get(group) ?? [];
      namedGroups.set(group, Array.from(new Set([...existing, toolName])));
    }
  }

  if (all.length > 0) {
    namedGroups.set("group:plugins", Array.from(new Set(all)));
  }

  return {
    all: Array.from(new Set(all)),
    byPlugin,
    namedGroups,
  };
}

export function expandPluginGroups(
  list: string[] | undefined,
  pluginGroups: PluginToolGroups,
): string[] | undefined {
  if (!Array.isArray(list) || list.length === 0) return list;

  const expanded: string[] = [];
  for (const entry of list) {
    const normalized = normalizeToolName(entry);
    const named = pluginGroups.namedGroups.get(normalized);
    if (named && named.length > 0) {
      expanded.push(...named);
      continue;
    }
    const pluginTools = pluginGroups.byPlugin.get(normalized);
    if (pluginTools && pluginTools.length > 0) {
      expanded.push(...pluginTools);
      continue;
    }
    expanded.push(normalized);
  }
  return Array.from(new Set(expanded));
}

export function expandPolicyWithPluginGroups(
  policy: ToolPolicyLike | undefined,
  pluginGroups: PluginToolGroups,
): ToolPolicyLike | undefined {
  if (!policy) return undefined;
  return {
    allow: expandPluginGroups(policy.allow, pluginGroups),
    deny: expandPluginGroups(policy.deny, pluginGroups),
  };
}

export function stripPluginOnlyAllowlist(
  policy: ToolPolicyLike | undefined,
  pluginGroups: PluginToolGroups,
  coreTools: Set<string>,
): AllowlistResolution {
  if (!policy?.allow || policy.allow.length === 0) {
    return { policy, unknownAllowlist: [], strippedAllowlist: false };
  }

  const normalized = normalizeToolList(policy.allow);
  if (normalized.length === 0) {
    return { policy, unknownAllowlist: [], strippedAllowlist: false };
  }

  const pluginIds = new Set(pluginGroups.byPlugin.keys());
  const pluginTools = new Set(pluginGroups.all);
  const unknownAllowlist: string[] = [];
  let hasCoreEntry = false;

  for (const entry of normalized) {
    const isPluginEntry =
      entry === "group:plugins" || pluginIds.has(entry) || pluginTools.has(entry);
    const expanded = expandToolGroups([entry]);
    const isCoreEntry = expanded.some((tool) => coreTools.has(tool));
    if (isCoreEntry) hasCoreEntry = true;
    if (!isCoreEntry && !isPluginEntry) unknownAllowlist.push(entry);
  }

  const strippedAllowlist = !hasCoreEntry;
  return {
    policy: strippedAllowlist ? { ...policy, allow: undefined } : policy,
    unknownAllowlist: Array.from(new Set(unknownAllowlist)),
    strippedAllowlist,
  };
}
