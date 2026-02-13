import type { CapabilityName } from "@/server/features/ai/contracts/capability-contract";

export type RuntimePlanIntent = "read" | "mutate" | "mixed" | "unknown";

export interface RuntimePlannerDraftStep {
  capabilityId: string;
  argsJson: string;
  rationale?: string;
}

export interface RuntimePlanStep {
  capabilityId: CapabilityName;
  args: Record<string, unknown>;
  rationale?: string;
}

export interface RuntimePlanValidationIssue {
  index: number;
  capabilityId: string;
  reason: string;
}

export interface RuntimeExecutionPlan {
  intent: RuntimePlanIntent;
  confidence: number;
  needsClarification?: string;
  source: "llm_plan" | "llm_plan_repaired" | "heuristic" | "none";
  steps: RuntimePlanStep[];
  issues: RuntimePlanValidationIssue[];
}
