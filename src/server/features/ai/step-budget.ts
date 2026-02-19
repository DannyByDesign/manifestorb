export type StepBudgetProfile =
  | "approval_decision"
  | "simple_lookup"
  | "single_action"
  | "contextual_followup"
  | "multi_step"
  | "complex";

export interface StepBudgetInput {
  message: string;
  provider: string;
  configuredMaxSteps: number;
  hasPendingApproval: boolean;
  hasPendingScheduleProposal: boolean;
}

function clampPositiveInt(value: number, fallback: number): number {
  const rounded = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, rounded);
}

export function classifyStepBudgetProfile(input: StepBudgetInput): StepBudgetProfile {
  const text = input.message.trim();
  if (!text) return "contextual_followup";

  const tokenCount = text.toLowerCase().split(/\s+/u).filter(Boolean).length;
  const sentenceCount = text
    .split(/[.!?;\n]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean).length;
  const clauseCount = text
    .split(/[,;]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean).length;
  const pendingContext = input.hasPendingApproval || input.hasPendingScheduleProposal;

  if (pendingContext && tokenCount <= 6 && sentenceCount <= 1) {
    return "approval_decision";
  }

  if (tokenCount <= 12 && sentenceCount <= 1 && clauseCount <= 1) {
    return "simple_lookup";
  }

  if (tokenCount <= 24 && sentenceCount <= 2 && clauseCount <= 1) {
    return "single_action";
  }

  if (tokenCount <= 48 && sentenceCount <= 4) return "multi_step";
  return "complex";
}

export function computeAdaptiveMaxSteps(input: StepBudgetInput): {
  profile: StepBudgetProfile;
  maxSteps: number;
} {
  const configured = clampPositiveInt(input.configuredMaxSteps, 20);
  const profile = classifyStepBudgetProfile(input);

  const budgetByProfile: Record<StepBudgetProfile, number> = {
    approval_decision: 3,
    simple_lookup: 4,
    single_action: 8,
    contextual_followup: 6,
    multi_step: 14,
    complex: configured,
  };

  return {
    profile,
    maxSteps: Math.min(configured, budgetByProfile[profile]),
  };
}
