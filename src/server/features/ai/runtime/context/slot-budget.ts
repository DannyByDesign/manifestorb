export type RuntimeLane =
  | "conversation_only"
  | "planner";

export interface RuntimeContextSlotBudget {
  maxChars: number;
  maxFacts: number;
  maxKnowledge: number;
  maxHistory: number;
}

const DEFAULT_BUDGETS: Record<RuntimeLane, RuntimeContextSlotBudget> = {
  conversation_only: {
    maxChars: 1_600,
    maxFacts: 4,
    maxKnowledge: 3,
    maxHistory: 3,
  },
  planner: {
    maxChars: 4_200,
    maxFacts: 10,
    maxKnowledge: 5,
    maxHistory: 8,
  },
};

export function resolveRuntimeContextSlotBudget(lane: RuntimeLane): RuntimeContextSlotBudget {
  return DEFAULT_BUDGETS[lane] ?? DEFAULT_BUDGETS.planner;
}
