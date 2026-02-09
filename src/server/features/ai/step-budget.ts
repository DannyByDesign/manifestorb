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

const APPROVAL_REPLY_PATTERN =
  /^(yes|yep|yeah|approve|approved|deny|denied|no|nah|cancel|go ahead|send it|do it)$/iu;
const LOOKUP_VERB_PATTERN =
  /\b(show|find|list|check|lookup|search|what|which|when|where|who|am i|do i have)\b/iu;
const MUTATION_VERB_PATTERN =
  /\b(create|schedule|reschedule|cancel|delete|trash|archive|mark|move|send|draft|update|modify|set|turn on|turn off)\b/iu;
const CONDITIONAL_PATTERN = /\b(if|unless|otherwise|except|only if|when)\b/iu;
const CHAINING_PATTERN =
  /\b(and then|then|also|plus|follow(ed)? by|after that|before that|next)\b/iu;
const BULK_PATTERN = /\b(all|every|bulk|entire|across)\b/iu;

function clampPositiveInt(value: number, fallback: number): number {
  const rounded = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, rounded);
}

function countMatches(text: string, pattern: RegExp): number {
  const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  return [...text.matchAll(globalPattern)].length;
}

function isCrossResourceRequest(text: string): boolean {
  const mentionsEmail = /\b(email|inbox|thread|message)\b/iu.test(text);
  const mentionsCalendar = /\b(calendar|meeting|event|schedule)\b/iu.test(text);
  const mentionsTasks = /\b(task|todo|to-do)\b/iu.test(text);
  const mentioned = [mentionsEmail, mentionsCalendar, mentionsTasks].filter(Boolean).length;
  return mentioned >= 2;
}

export function classifyStepBudgetProfile(input: StepBudgetInput): StepBudgetProfile {
  const text = input.message.trim().toLowerCase();
  if (!text) return "contextual_followup";

  const tokenCount = text.split(/\s+/u).filter(Boolean).length;
  const hasConditional = CONDITIONAL_PATTERN.test(text);
  const chainCount = countMatches(text, CHAINING_PATTERN);
  const hasBulk = BULK_PATTERN.test(text);
  const isLookup = LOOKUP_VERB_PATTERN.test(text);
  const isMutation = MUTATION_VERB_PATTERN.test(text);
  const crossResource = isCrossResourceRequest(text);
  const pendingContext = input.hasPendingApproval || input.hasPendingScheduleProposal;

  if (pendingContext && APPROVAL_REPLY_PATTERN.test(text)) {
    return "approval_decision";
  }

  if (
    hasConditional ||
    chainCount >= 2 ||
    crossResource ||
    (hasBulk && isMutation)
  ) {
    return "multi_step";
  }

  if (isLookup && !isMutation && tokenCount <= 24) {
    return "simple_lookup";
  }

  if (isMutation && !hasConditional && chainCount === 0 && !crossResource) {
    return "single_action";
  }

  if (tokenCount <= 10) return "contextual_followup";
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

