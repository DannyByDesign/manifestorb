export type RuntimeLane =
  | "direct_response"
  | "macro_tool"
  | "planner_fast"
  | "planner_standard"
  | "planner_deep";

export interface RuntimeContextSlotBudget {
  maxChars: number;
  maxFacts: number;
  maxKnowledge: number;
  maxHistory: number;
}

const DEFAULT_BUDGETS: Record<RuntimeLane, RuntimeContextSlotBudget> = {
  direct_response: {
    maxChars: 1_200,
    maxFacts: 3,
    maxKnowledge: 2,
    maxHistory: 2,
  },
  macro_tool: {
    maxChars: 1_800,
    maxFacts: 4,
    maxKnowledge: 3,
    maxHistory: 3,
  },
  planner_fast: {
    maxChars: 2_400,
    maxFacts: 6,
    maxKnowledge: 3,
    maxHistory: 4,
  },
  planner_standard: {
    maxChars: 3_200,
    maxFacts: 8,
    maxKnowledge: 4,
    maxHistory: 6,
  },
  planner_deep: {
    maxChars: 4_200,
    maxFacts: 10,
    maxKnowledge: 5,
    maxHistory: 8,
  },
};

export function resolveRuntimeContextSlotBudget(lane: RuntimeLane): RuntimeContextSlotBudget {
  return DEFAULT_BUDGETS[lane] ?? DEFAULT_BUDGETS.planner_standard;
}
