import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";
import type { ToolPolicyLike } from "@/server/features/ai/tools/policy/types";
import { expandToolGroups, normalizeToolName } from "@/server/features/ai/tools/policy/tool-policy";

type CompiledPattern =
  | { kind: "all" }
  | { kind: "exact"; value: string }
  | { kind: "regex"; value: RegExp };

export function compilePattern(pattern: string): CompiledPattern {
  const normalized = normalizeToolName(pattern);
  if (!normalized) return { kind: "exact", value: "" };
  if (normalized === "*") return { kind: "all" };
  if (!normalized.includes("*")) return { kind: "exact", value: normalized };
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    kind: "regex",
    value: new RegExp(`^${escaped.replaceAll("\\*", ".*")}$`),
  };
}

export function compilePatterns(
  patterns: string[] | undefined,
  additionalGroups?: Record<string, string[]>,
): CompiledPattern[] {
  if (!Array.isArray(patterns)) return [];
  return expandToolGroups(patterns, additionalGroups)
    .map((pattern) => compilePattern(pattern))
    .filter((pattern) => pattern.kind !== "exact" || pattern.value);
}

function matchesAny(name: string, patterns: CompiledPattern[]): boolean {
  for (const pattern of patterns) {
    if (pattern.kind === "all") return true;
    if (pattern.kind === "exact" && name === pattern.value) return true;
    if (pattern.kind === "regex" && pattern.value.test(name)) return true;
  }
  return false;
}

export function makeToolPolicyMatcher(
  policy: ToolPolicyLike,
  additionalGroups?: Record<string, string[]>,
): (name: string) => boolean {
  const deny = compilePatterns(policy.deny, additionalGroups);
  const allow = compilePatterns(policy.allow, additionalGroups);

  return (name: string) => {
    const normalized = normalizeToolName(name);
    if (matchesAny(normalized, deny)) return false;
    if (allow.length === 0) return true;
    if (matchesAny(normalized, allow)) return true;
    return false;
  };
}

export function isToolAllowedByPolicyName(
  name: string,
  policy?: ToolPolicyLike,
  additionalGroups?: Record<string, string[]>,
): boolean {
  if (!policy) return true;
  return makeToolPolicyMatcher(policy, additionalGroups)(name);
}

export function isToolAllowedByPolicies(
  name: string,
  policies: Array<ToolPolicyLike | undefined>,
  additionalGroups?: Record<string, string[]>,
): boolean {
  return policies.every((policy) => isToolAllowedByPolicyName(name, policy, additionalGroups));
}

export function filterToolsByPolicy(
  tools: RuntimeToolDefinition[],
  policy?: ToolPolicyLike,
  additionalGroups?: Record<string, string[]>,
): RuntimeToolDefinition[] {
  if (!policy) return tools;
  const matcher = makeToolPolicyMatcher(policy, additionalGroups);
  return tools.filter((tool) => matcher(tool.toolName));
}
