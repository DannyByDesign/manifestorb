import type { SkillContract, CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import type { SkillId } from "@/server/features/ai/skills/baseline/skill-ids";

export function createBaselineSkill(input: {
  id: SkillId;
  intents: string[];
  requiredSlots: string[];
  optionalSlots?: string[];
  allowedTools: CapabilityName[];
  risk?: SkillContract["risk_level"];
  requiresApproval?: boolean;
  plan: Array<{ id: string; description: string; capability?: CapabilityName; requiredSlots?: string[] }>;
  successChecks: Array<{ id: string; description: string }>;
  failureModes: Array<{ code: string; description: string; recoveryPrompt: string }>;
  templates: SkillContract["user_response_templates"];
}): SkillContract {
  return {
    id: input.id,
    intent_examples: input.intents,
    required_slots: input.requiredSlots,
    optional_slots: input.optionalSlots ?? [],
    allowed_tools: input.allowedTools,
    plan: input.plan,
    success_checks: input.successChecks,
    failure_modes: input.failureModes,
    user_response_templates: input.templates,
    risk_level: input.risk ?? "caution",
    requires_approval: input.requiresApproval ?? false,
    idempotency_scope: "thread",
    supports_dry_run: true,
    owner: "ai-platform",
    version: "1.0.0",
  };
}
