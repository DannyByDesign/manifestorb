import { ActionType } from "@/generated/prisma/enums";
import type { CanonicalRuleCreateInput } from "@/server/features/policy-plane/canonical-schema";
import { compileRulePlaneRule } from "@/server/features/policy-plane/service";

type PromptToRulesEmailAccount = {
  id: string;
  userId: string;
  email: string;
};

type LegacyAction = {
  type: string;
  [key: string]: unknown;
};

export interface PromptToRulesResult {
  ruleId: string;
  name?: string;
  actions?: LegacyAction[];
  canonical: CanonicalRuleCreateInput;
}

function buildDefaultScheduleMeetingRule(input: string): CanonicalRuleCreateInput {
  return {
    type: "automation",
    enabled: true,
    priority: 0,
    name: "Schedule meeting requests",
    description: "Auto-generated compatibility rule from natural language prompt.",
    scope: {
      surfaces: ["web", "slack", "discord", "telegram", "system"],
      resources: ["email"],
    },
    trigger: {
      kind: "event",
      eventType: "email.received",
    },
    match: {
      resource: "email",
      operation: "inbound_received",
      conditions: [
        {
          field: "email.subject",
          op: "contains",
          value: "meeting",
        },
      ],
    },
    actionPlan: {
      actions: [
        {
          actionType: ActionType.SCHEDULE_MEETING,
          args: {},
          idempotencyScope: "thread",
        },
      ],
    },
    source: {
      mode: "ai_nl",
      sourceNl: input,
      compilerVersion: "compat-v1",
      compilerConfidence: 0.6,
      compilerWarnings: [
        "Used deterministic compatibility fallback for schedule-meeting inference.",
      ],
    },
  };
}

function hasScheduleMeetingAction(
  candidate: CanonicalRuleCreateInput | undefined,
): boolean {
  const actions = candidate?.actionPlan?.actions ?? [];
  return actions.some((action) => action.actionType === ActionType.SCHEDULE_MEETING);
}

function toLegacyActions(candidate: CanonicalRuleCreateInput): LegacyAction[] {
  const actions = candidate.actionPlan?.actions ?? [];
  return actions.map((action) => ({
    type: action.actionType,
    ...(action.args ?? {}),
  }));
}

function likelyMeetingPrompt(input: string): boolean {
  const normalized = input.toLowerCase();
  return normalized.includes("meeting") || normalized.includes("schedule") || normalized.includes("call");
}

export async function aiPromptToRules(params: {
  emailAccount: PromptToRulesEmailAccount;
  promptFile: string;
}): Promise<PromptToRulesResult[]> {
  const input = params.promptFile.trim();
  if (!input) return [];

  const compiled = await compileRulePlaneRule({
    input,
    emailAccount: params.emailAccount,
  });

  let candidate = compiled.candidate;

  if (!candidate) {
    if (!likelyMeetingPrompt(input)) return [];
    candidate = buildDefaultScheduleMeetingRule(input);
  } else if (!hasScheduleMeetingAction(candidate) && likelyMeetingPrompt(input)) {
    candidate = buildDefaultScheduleMeetingRule(input);
  }

  return [
    {
      ruleId: "preview-rule",
      name: candidate.name,
      actions: toLegacyActions(candidate),
      canonical: candidate,
    },
  ];
}
