import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";
import type { ToolPolicyLike } from "@/server/features/ai/tools/policy/types";
import { expandToolGroups, normalizeToolName } from "@/server/features/ai/tools/policy/tool-policy";

type CompiledPattern =
  | { kind: "all" }
  | { kind: "exact"; value: string }
  | { kind: "glob"; segments: string[] };

export function compilePattern(pattern: string): CompiledPattern {
  const normalized = normalizeToolName(pattern);
  if (!normalized) return { kind: "exact", value: "" };
  if (normalized === "*") return { kind: "all" };
  if (!normalized.includes("*")) return { kind: "exact", value: normalized };
  return {
    kind: "glob",
    segments: normalized.split("*"),
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

function matchesGlob(name: string, segments: string[]): boolean {
  if (segments.length === 0) return name.length === 0;
  let cursor = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] ?? "";
    if (!segment) continue;
    if (i === 0 && !name.startsWith(segment)) return false;
    if (i === segments.length - 1 && !name.endsWith(segment)) return false;
    const foundAt = name.indexOf(segment, cursor);
    if (foundAt < 0) return false;
    cursor = foundAt + segment.length;
  }
  return true;
}

function matchesAny(name: string, patterns: CompiledPattern[]): boolean {
  for (const pattern of patterns) {
    if (pattern.kind === "all") return true;
    if (pattern.kind === "exact" && name === pattern.value) return true;
    if (pattern.kind === "glob" && matchesGlob(name, pattern.segments)) return true;
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
    if (normalized === "apply_patch" && matchesAny("exec", allow)) return true;
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
