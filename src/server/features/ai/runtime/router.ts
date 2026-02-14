import { matchRuntimeFastPath, type RuntimeFastPathMatch } from "@/server/features/ai/runtime/fast-path";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";

export type RuntimeRoutingLane =
  | "direct_response"
  | "macro_tool"
  | "planner_fast"
  | "planner_standard"
  | "planner_deep";

export interface RuntimeRoutingPlan {
  lane: RuntimeRoutingLane;
  reason: string;
  maxAttempts: number;
  decisionTimeoutMs: number;
  repairTimeoutMs: number;
  responseWriteTimeoutMs: number;
  decisionToolCatalogLimit: number;
  includeSkillGuidance: boolean;
  fastPathMatch?: RuntimeFastPathMatch;
}

const LOOKUP_VERB_RE = /\b(show|list|find|check|lookup|search|what|which|when|where|who|do i have)\b/u;
const MUTATION_VERB_RE =
  /\b(create|update|edit|change|delete|remove|archive|trash|send|reply|move|label|reschedule|book|cancel|approve|deny)\b/u;
const CONDITIONAL_RE = /\b(if|unless|otherwise|except|only if|when)\b/u;
const CHAINING_RE = /\b(and then|then|also|plus|follow(?:ed)? by|after that|before that|next)\b/u;
const EMAIL_RE = /\b(email|inbox|message|thread|draft)\b/u;
const CALENDAR_RE = /\b(calendar|meeting|event|schedule)\b/u;
const TASK_RE = /\b(task|todo|to-do)\b/u;

const ROUTE_PRESETS: Record<
  Exclude<RuntimeRoutingLane, "direct_response" | "macro_tool">,
  Omit<RuntimeRoutingPlan, "lane" | "reason" | "fastPathMatch">
> = {
  planner_fast: {
    maxAttempts: 2,
    decisionTimeoutMs: 8_000,
    repairTimeoutMs: 3_000,
    responseWriteTimeoutMs: 5_000,
    decisionToolCatalogLimit: 10,
    includeSkillGuidance: false,
  },
  planner_standard: {
    maxAttempts: 4,
    decisionTimeoutMs: 20_000,
    repairTimeoutMs: 8_000,
    responseWriteTimeoutMs: 10_000,
    decisionToolCatalogLimit: 16,
    includeSkillGuidance: true,
  },
  planner_deep: {
    maxAttempts: 6,
    decisionTimeoutMs: 45_000,
    repairTimeoutMs: 12_000,
    responseWriteTimeoutMs: 12_000,
    decisionToolCatalogLimit: 24,
    includeSkillGuidance: true,
  },
};

function tokenCount(message: string): number {
  return message.split(/\s+/u).filter(Boolean).length;
}

function countMatches(message: string, expression: RegExp): number {
  const globalExpression = new RegExp(expression.source, `${expression.flags.replace("g", "")}g`);
  return [...message.matchAll(globalExpression)].length;
}

function isCrossDomainRequest(message: string): boolean {
  const signals = [EMAIL_RE.test(message), CALENDAR_RE.test(message), TASK_RE.test(message)];
  return signals.filter(Boolean).length >= 2;
}

function classifyPlannerLane(message: string): {
  lane: "planner_fast" | "planner_standard" | "planner_deep";
  reason: string;
} {
  const count = tokenCount(message);
  const isMutation = MUTATION_VERB_RE.test(message);
  const hasLookupVerb = LOOKUP_VERB_RE.test(message);
  const hasConditional = CONDITIONAL_RE.test(message);
  const chainCount = countMatches(message, CHAINING_RE);
  const crossDomain = isCrossDomainRequest(message);
  const hasBulk = /\b(all|every|bulk|entire|across)\b/u.test(message);

  if (hasConditional || chainCount >= 2 || crossDomain || (hasBulk && isMutation)) {
    return {
      lane: "planner_deep",
      reason: "complex_or_cross_domain",
    };
  }

  if (!isMutation && hasLookupVerb && count <= 20) {
    return {
      lane: "planner_fast",
      reason: "simple_lookup",
    };
  }

  return {
    lane: "planner_standard",
    reason: isMutation ? "single_mutation" : "default_standard",
  };
}

export async function buildRuntimeRoutingPlan(params: {
  session: RuntimeSession;
}): Promise<RuntimeRoutingPlan> {
  const { session } = params;
  const normalized = session.input.message.trim().toLowerCase();

  const strictFastPath = await matchRuntimeFastPath({
    session,
    mode: "strict",
  });
  if (strictFastPath) {
    return {
      lane: strictFastPath.type === "respond" ? "direct_response" : "macro_tool",
      reason: `fast_path:${strictFastPath.reason}`,
      maxAttempts: 1,
      decisionTimeoutMs: 0,
      repairTimeoutMs: 0,
      responseWriteTimeoutMs: 5_000,
      decisionToolCatalogLimit: 0,
      includeSkillGuidance: false,
      fastPathMatch: strictFastPath,
    };
  }

  const planner = classifyPlannerLane(normalized);
  const preset = ROUTE_PRESETS[planner.lane];
  return {
    lane: planner.lane,
    reason: planner.reason,
    ...preset,
  };
}
