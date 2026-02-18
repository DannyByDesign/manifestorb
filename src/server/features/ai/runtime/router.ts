import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeSingleToolCall } from "@/server/features/ai/runtime/turn-compiler";

export type RuntimeRoutingLane = "conversation_only" | "single_tool" | "planner";

export interface RuntimeRoutingPlan {
  lane: RuntimeRoutingLane;
  reason: string;
  profile: "fast" | "standard" | "deep";
  nativeMaxSteps: number;
  nativeTurnTimeoutMs: number;
  maxAttempts: number;
  decisionTimeoutMs: number;
  repairTimeoutMs: number;
  responseWriteTimeoutMs: number;
  decisionToolCatalogLimit: number;
  includeSkillGuidance: boolean;
  singleToolCall?: RuntimeSingleToolCall;
}

const PROFILE_PRESETS: Record<
  RuntimeRoutingPlan["profile"],
  Omit<RuntimeRoutingPlan, "lane" | "reason" | "profile" | "singleToolCall">
> = {
  fast: {
    nativeMaxSteps: 4,
    nativeTurnTimeoutMs: 25_000,
    maxAttempts: 2,
    decisionTimeoutMs: 8_000,
    repairTimeoutMs: 3_000,
    responseWriteTimeoutMs: 5_000,
    decisionToolCatalogLimit: 10,
    includeSkillGuidance: false,
  },
  standard: {
    nativeMaxSteps: 8,
    nativeTurnTimeoutMs: 75_000,
    maxAttempts: 4,
    decisionTimeoutMs: 20_000,
    repairTimeoutMs: 8_000,
    responseWriteTimeoutMs: 10_000,
    decisionToolCatalogLimit: 16,
    includeSkillGuidance: true,
  },
  deep: {
    nativeMaxSteps: 16,
    nativeTurnTimeoutMs: 165_000,
    maxAttempts: 6,
    decisionTimeoutMs: 45_000,
    repairTimeoutMs: 12_000,
    responseWriteTimeoutMs: 12_000,
    decisionToolCatalogLimit: 24,
    includeSkillGuidance: true,
  },
};

function resolvePlannerProfile(session: RuntimeSession): RuntimeRoutingPlan["profile"] {
  if (session.turn.complexity === "complex" || session.turn.domain === "cross_surface") {
    return "deep";
  }
  if (session.turn.complexity === "moderate" || session.turn.requestedOperation === "mutate") {
    return "standard";
  }
  return "fast";
}

export async function buildRuntimeRoutingPlan(params: {
  session: RuntimeSession;
}): Promise<RuntimeRoutingPlan> {
  const { session } = params;
  const profile = resolvePlannerProfile(session);

  if (session.turn.toolChoice === "none" || session.turn.routeHint === "conversation_only") {
    return {
      lane: "conversation_only",
      reason: session.turn.toolChoice === "none" ? "turn_policy:tool_choice_none" : "turn_compiler:conversation_only",
      profile,
      ...PROFILE_PRESETS.fast,
      // Run one native turn with tools disabled. (ToolChoice is enforced in the session runner.)
      nativeMaxSteps: 1,
      nativeTurnTimeoutMs: 18_000,
      maxAttempts: 1,
      decisionTimeoutMs: 0,
      repairTimeoutMs: 0,
      responseWriteTimeoutMs: 6_000,
      decisionToolCatalogLimit: 0,
      includeSkillGuidance: false,
    };
  }

  if (session.turn.routeHint === "single_tool" && session.turn.singleToolCall) {
    const toolAvailable = session.toolLookup.has(session.turn.singleToolCall.toolName);
    if (toolAvailable) {
      return {
        lane: "single_tool",
        reason: `turn_compiler:single_tool:${session.turn.singleToolCall.reason}`,
        profile,
        ...PROFILE_PRESETS.fast,
        nativeMaxSteps: 0,
        nativeTurnTimeoutMs: 0,
        maxAttempts: 1,
        decisionTimeoutMs: 0,
        repairTimeoutMs: 0,
        responseWriteTimeoutMs: 7_000,
        decisionToolCatalogLimit: 0,
        includeSkillGuidance: false,
        singleToolCall: session.turn.singleToolCall,
      };
    }
  }

  return {
    lane: "planner",
    reason:
      session.turn.routeHint === "single_tool"
        ? "turn_compiler:single_tool_tool_unavailable"
        : "turn_compiler:planner",
    profile,
    ...PROFILE_PRESETS[profile],
  };
}
