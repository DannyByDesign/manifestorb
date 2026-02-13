import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";

export type PlannerRisk = "safe" | "caution" | "dangerous";

export interface PlannerStep {
  id: string;
  capability: CapabilityName;
  args: Record<string, unknown>;
  dependsOn?: string[];
  postcondition?: string;
  risk?: PlannerRisk;
}

export interface PlannerPlan {
  goal: string;
  steps: PlannerStep[];
}

export interface PlannerValidationIssue {
  code: string;
  message: string;
  stepId?: string;
}

export interface PlannerExecutionStepResult {
  stepId: string;
  capability: CapabilityName;
  success: boolean;
  message?: string;
  policyBlocked?: boolean;
  itemCount?: number;
  errorCode?: string;
}

export interface PlannerExecutionResult {
  status: "success" | "partial" | "blocked" | "failed";
  responseText: string;
  interactivePayloads: unknown[];
  approvals: Array<{ id: string; requestPayload?: unknown }>;
  stepResults: PlannerExecutionStepResult[];
  diagnosticsCode?: string;
  diagnosticsCategory?:
    | "missing_context"
    | "policy"
    | "transient"
    | "provider"
    | "unsupported"
    | "unknown";
  clarificationPrompt?: string;
  missingFields?: string[];
}
