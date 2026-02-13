import {
  compileNaturalLanguageRule,
  type RuleCompilerResult,
} from "@/server/features/policy-plane/compiler";
import {
  createCanonicalRule,
  deleteCanonicalRule,
  disableCanonicalRule,
  listEffectiveCanonicalRules,
  updateCanonicalRule,
} from "@/server/features/policy-plane/repository";
import type { CanonicalRuleCreateInput, CanonicalRuleType } from "@/server/features/policy-plane/canonical-schema";

export async function listRulePlaneSnapshot(params: {
  userId: string;
  emailAccountId?: string;
}) {
  const rules = await listEffectiveCanonicalRules({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
  });
  return {
    rules,
    summary: {
      total: rules.length,
      guardrails: rules.filter((rule) => rule.type === "guardrail").length,
      automations: rules.filter((rule) => rule.type === "automation").length,
      preferences: rules.filter((rule) => rule.type === "preference").length,
    },
  };
}

export async function listRulePlaneRulesByType(params: {
  userId: string;
  emailAccountId?: string;
  type?: CanonicalRuleType;
}) {
  return listEffectiveCanonicalRules({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    type: params.type,
  });
}

export async function createRulePlaneRule(params: {
  userId: string;
  emailAccountId?: string;
  rule: CanonicalRuleCreateInput;
}) {
  return createCanonicalRule({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    rule: params.rule,
  });
}

export async function updateRulePlaneRule(params: {
  userId: string;
  id: string;
  patch: Partial<CanonicalRuleCreateInput>;
}) {
  return updateCanonicalRule({
    userId: params.userId,
    id: params.id,
    patch: params.patch,
  });
}

export async function disableRulePlaneRule(params: {
  userId: string;
  id: string;
  disabledUntil?: string;
}) {
  return disableCanonicalRule({
    userId: params.userId,
    id: params.id,
    disabledUntil: params.disabledUntil,
  });
}

export async function removeRulePlaneRule(params: { userId: string; id: string }) {
  return deleteCanonicalRule({
    userId: params.userId,
    id: params.id,
  });
}

export async function compileRulePlaneRule(params: {
  input: string;
  emailAccount: { id: string; email: string; userId: string };
}): Promise<RuleCompilerResult> {
  return compileNaturalLanguageRule({
    input: params.input,
    emailAccount: params.emailAccount,
  });
}

export async function compileAndActivateRulePlaneRule(params: {
  input: string;
  userId: string;
  emailAccount: { id: string; email: string; userId: string };
}) {
  const compiled = await compileRulePlaneRule({
    input: params.input,
    emailAccount: params.emailAccount,
  });
  if (!compiled.candidate || compiled.needsClarification || !compiled.ok) {
    return {
      activated: false,
      compiled,
      rule: null,
    };
  }
  const rule = await createCanonicalRule({
    userId: params.userId,
    emailAccountId: params.emailAccount.id,
    rule: compiled.candidate,
  });
  return {
    activated: true,
    compiled,
    rule,
  };
}
