import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import {
  compileAndActivateRulePlaneRule,
  compileRulePlaneRule,
  createRulePlaneRule,
  disableRulePlaneRule,
  listRulePlaneRulesByType,
  removeRulePlaneRule,
  updateRulePlaneRule,
} from "@/server/features/policy-plane/service";
import type {
  CanonicalRule,
  CanonicalRuleType,
} from "@/server/features/policy-plane/canonical-schema";

const RULE_TARGET_SELECTOR_SCHEMA = z
  .object({
    decision: z.enum(["resolved", "ambiguous", "not_found"]),
    selectedRuleId: z.string().min(1).optional(),
    candidateRuleIds: z.array(z.string().min(1)).max(3).default([]),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

const RULE_TARGET_MIN_CONFIDENCE = 0.75;
const RULE_TARGET_MAX_CANDIDATES = 25;

function failure(message: string, error?: unknown): ToolResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : undefined,
    message,
  };
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function summarizeRuleForSelection(rule: CanonicalRule): Record<string, unknown> {
  const conditions = Array.isArray(rule.match.conditions)
    ? rule.match.conditions.slice(0, 3).map((condition) => ({
        field: condition.field,
        op: condition.op,
      }))
    : [];

  const actionTypes = Array.isArray(rule.actionPlan?.actions)
    ? rule.actionPlan.actions.slice(0, 3).map((action) => action.actionType)
    : [];

  return {
    id: rule.id,
    type: rule.type,
    enabled: rule.enabled,
    name: truncate(rule.name, 120) ?? null,
    description: truncate(rule.description, 180) ?? null,
    sourceNl: truncate(rule.source.sourceNl, 180) ?? null,
    resource: rule.match.resource,
    operation: rule.match.operation ?? null,
    conditions,
    actionTypes,
  };
}

function buildRuleClarificationPrompt(params: {
  action: "update" | "disable" | "delete";
  target: string;
  candidates: CanonicalRule[];
  notFound?: boolean;
}): string {
  if (params.notFound || params.candidates.length === 0) {
    return `I couldn't find a matching rule for "${params.target}". Tell me the rule name exactly, or ask me to list your rules first.`;
  }

  const actionVerb =
    params.action === "update"
      ? "update"
      : params.action === "disable"
        ? "disable"
        : "delete";

  const labelList = params.candidates
    .slice(0, 3)
    .map((rule) => `"${rule.name ?? rule.description ?? rule.id}"`)
    .join(", ");

  return `I found multiple possible rules for "${params.target}". Which one should I ${actionVerb}: ${labelList}?`;
}

async function selectRuleFromTarget(params: {
  env: CapabilityEnvironment;
  action: "update" | "disable" | "delete";
  type?: CanonicalRuleType;
  target: string;
}): Promise<{ ok: true; id: string } | { ok: false; result: ToolResult }> {
  const target = params.target.trim();
  if (target.length === 0) {
    return {
      ok: false,
      result: {
        success: false,
        error: "missing_rule_target",
        message: "I need a rule name or description to identify it.",
        clarification: {
          kind: "missing_fields",
          prompt: "Which rule should I use? You can say part of the rule name.",
          missingFields: ["rule_target"],
        },
      },
    };
  }

  const rules = await listRulePlaneRulesByType({
    userId: params.env.runtime.userId,
    emailAccountId: params.env.runtime.emailAccountId,
    type: params.type,
  });

  if (rules.length === 0) {
    return {
      ok: false,
      result: {
        success: false,
        error: "rule_not_found",
        message: "You don't have any matching rules yet.",
        clarification: {
          kind: "invalid_fields",
          prompt: buildRuleClarificationPrompt({
            action: params.action,
            target,
            candidates: [],
            notFound: true,
          }),
          missingFields: ["rule_target"],
        },
      },
    };
  }

  const normalizedTarget = normalizeText(target);
  const exactNameMatches = rules.filter((rule) => {
    const normalizedName = normalizeText(rule.name ?? "");
    return normalizedName.length > 0 && normalizedName === normalizedTarget;
  });

  if (exactNameMatches.length === 1) {
    return { ok: true, id: exactNameMatches[0]!.id };
  }

  if (exactNameMatches.length > 1) {
    return {
      ok: false,
      result: {
        success: false,
        error: "ambiguous_rule_target",
        message: "More than one rule has the same name.",
        clarification: {
          kind: "invalid_fields",
          prompt: buildRuleClarificationPrompt({
            action: params.action,
            target,
            candidates: exactNameMatches,
          }),
          missingFields: ["rule_target"],
        },
      },
    };
  }

  const candidates = rules.slice(0, RULE_TARGET_MAX_CANDIDATES);
  const candidateById = new Map(candidates.map((rule) => [rule.id, rule]));
  const candidatePayload = candidates.map(summarizeRuleForSelection);

  try {
    const modelOptions = getModel("economy");
    const generateObject = createGenerateObject({
      emailAccount: {
        id: params.env.runtime.emailAccountId,
        email: params.env.runtime.email,
        userId: params.env.runtime.userId,
      },
      label: "policy-rule-target-selection",
      modelOptions,
      maxLLMRetries: 0,
    });

    const { object } = await generateObject({
      model: modelOptions.model,
      schema: RULE_TARGET_SELECTOR_SCHEMA,
      prompt: [
        "Select the best matching canonical rule for the requested mutation.",
        "If one rule is clearly intended, return decision=resolved and selectedRuleId.",
        "If multiple rules could match, return decision=ambiguous and up to 3 candidateRuleIds.",
        "If no candidate matches, return decision=not_found.",
        "Be conservative. Do not guess.",
        `Action: ${params.action}`,
        `Target text: ${target}`,
        `Candidates JSON: ${JSON.stringify(candidatePayload)}`,
      ].join("\n\n"),
    });

    if (object.decision === "resolved") {
      const selectedId = object.selectedRuleId?.trim();
      const confidence = object.confidence ?? 1;
      if (
        selectedId &&
        candidateById.has(selectedId) &&
        Number.isFinite(confidence) &&
        confidence >= RULE_TARGET_MIN_CONFIDENCE
      ) {
        return { ok: true, id: selectedId };
      }
    }

    if (object.decision === "not_found") {
      return {
        ok: false,
        result: {
          success: false,
          error: "rule_not_found",
          message: "I couldn't find a matching rule.",
          clarification: {
            kind: "invalid_fields",
            prompt: buildRuleClarificationPrompt({
              action: params.action,
              target,
              candidates,
              notFound: true,
            }),
            missingFields: ["rule_target"],
          },
        },
      };
    }

    const shortlisted = object.candidateRuleIds
      .map((id) => candidateById.get(id))
      .filter((candidate): candidate is CanonicalRule => Boolean(candidate));

    return {
      ok: false,
      result: {
        success: false,
        error: "ambiguous_rule_target",
        message: "I found multiple possible rules.",
        clarification: {
          kind: "invalid_fields",
          prompt: buildRuleClarificationPrompt({
            action: params.action,
            target,
            candidates: shortlisted.length > 0 ? shortlisted : candidates,
          }),
          missingFields: ["rule_target"],
        },
      },
    };
  } catch (error) {
    params.env.runtime.logger.warn("Policy rule target selection failed", {
      action: params.action,
      target,
      error,
    });
    return {
      ok: false,
      result: {
        success: false,
        error: "rule_target_selection_failed",
        message: "I couldn't confidently identify the rule.",
        clarification: {
          kind: "other",
          prompt: buildRuleClarificationPrompt({
            action: params.action,
            target,
            candidates,
          }),
          missingFields: ["rule_target"],
        },
      },
    };
  }
}

async function resolveRuleIdForMutation(params: {
  env: CapabilityEnvironment;
  action: "update" | "disable" | "delete";
  id?: string;
  target?: string;
  type?: CanonicalRuleType;
}): Promise<{ ok: true; id: string } | { ok: false; result: ToolResult }> {
  const directId = params.id?.trim();
  if (directId) return { ok: true, id: directId };
  return await selectRuleFromTarget({
    env: params.env,
    action: params.action,
    target: params.target ?? "",
    type: params.type,
  });
}

export interface PolicyCapabilities {
  listRules(input: { type?: CanonicalRuleType }): Promise<ToolResult>;
  compileRule(input: { input: string }): Promise<ToolResult>;
  createRule(input: { input: string; activate?: boolean }): Promise<ToolResult>;
  updateRule(input: {
    id?: string;
    target?: string;
    type?: CanonicalRuleType;
    patch: Record<string, unknown>;
  }): Promise<ToolResult>;
  disableRule(input: {
    id?: string;
    target?: string;
    type?: CanonicalRuleType;
    disabledUntil?: string;
  }): Promise<ToolResult>;
  deleteRule(input: {
    id?: string;
    target?: string;
    type?: CanonicalRuleType;
  }): Promise<ToolResult>;
}

export function createPolicyCapabilities(env: CapabilityEnvironment): PolicyCapabilities {
  return {
    async listRules(input) {
      try {
        const rules = await listRulePlaneRulesByType({
          userId: env.runtime.userId,
          emailAccountId: env.runtime.emailAccountId,
          type: input.type,
        });
        return {
          success: true,
          data: rules,
          message: `Loaded ${rules.length} rule-plane rule${rules.length === 1 ? "" : "s"}.`,
          meta: { resource: "rule", itemCount: rules.length },
        };
      } catch (error) {
        return failure("I couldn't load your rule plane right now.", error);
      }
    },
    async compileRule(input) {
      if (!input.input || input.input.trim().length === 0) {
        return {
          success: false,
          error: "missing_rule_input",
          message: "I need the rule text to compile it.",
          clarification: {
            kind: "missing_fields",
            prompt: "Describe the rule you want to compile.",
            missingFields: ["rule_input"],
          },
        };
      }
      try {
        const compiled = await compileRulePlaneRule({
          input: input.input,
          emailAccount: {
            id: env.runtime.emailAccountId,
            email: env.runtime.email,
            userId: env.runtime.userId,
          },
        });
        return {
          success: true,
          data: compiled,
          message: compiled.explanation,
          meta: { resource: "rule", itemCount: compiled.candidate ? 1 : 0 },
        };
      } catch (error) {
        return failure("I couldn't compile that rule request.", error);
      }
    },
    async createRule(input) {
      if (!input.input || input.input.trim().length === 0) {
        return {
          success: false,
          error: "missing_rule_input",
          message: "I need the rule text to create it.",
          clarification: {
            kind: "missing_fields",
            prompt: "Describe the rule you want to create.",
            missingFields: ["rule_input"],
          },
        };
      }
      try {
        if (input.activate ?? true) {
          const activated = await compileAndActivateRulePlaneRule({
            input: input.input,
            userId: env.runtime.userId,
            emailAccount: {
              id: env.runtime.emailAccountId,
              email: env.runtime.email,
              userId: env.runtime.userId,
            },
          });
          return {
            success: activated.activated,
            data: activated,
            message: activated.activated
              ? "Rule activated."
              : activated.compiled.explanation,
            meta: { resource: "rule", itemCount: activated.activated ? 1 : 0 },
          };
        }

        const compiled = await compileRulePlaneRule({
          input: input.input,
          emailAccount: {
            id: env.runtime.emailAccountId,
            email: env.runtime.email,
            userId: env.runtime.userId,
          },
        });
        if (!compiled.ok || !compiled.candidate) {
          return {
            success: false,
            data: compiled,
            message: compiled.explanation,
          };
        }
        const rule = await createRulePlaneRule({
          userId: env.runtime.userId,
          emailAccountId: env.runtime.emailAccountId,
          rule: compiled.candidate,
        });
        return {
          success: true,
          data: rule,
          message: "Rule created.",
          meta: { resource: "rule", itemCount: 1 },
        };
      } catch (error) {
        return failure("I couldn't create that rule.", error);
      }
    },
    async updateRule(input) {
      const resolved = await resolveRuleIdForMutation({
        env,
        action: "update",
        id: input.id,
        target: input.target,
        type: input.type,
      });
      if (!resolved.ok) return resolved.result;

      try {
        const rule = await updateRulePlaneRule({
          userId: env.runtime.userId,
          id: resolved.id,
          patch: input.patch,
        });
        if (!rule) return failure("Rule not found.");
        return {
          success: true,
          data: rule,
          message: "Rule updated.",
          meta: { resource: "rule", itemCount: 1 },
        };
      } catch (error) {
        return failure("I couldn't update that rule.", error);
      }
    },
    async disableRule(input) {
      const resolved = await resolveRuleIdForMutation({
        env,
        action: "disable",
        id: input.id,
        target: input.target,
        type: input.type,
      });
      if (!resolved.ok) return resolved.result;

      try {
        const rule = await disableRulePlaneRule({
          userId: env.runtime.userId,
          id: resolved.id,
          disabledUntil: input.disabledUntil,
        });
        if (!rule) return failure("Rule not found.");
        return {
          success: true,
          data: rule,
          message: "Rule disabled.",
          meta: { resource: "rule", itemCount: 1 },
        };
      } catch (error) {
        return failure("I couldn't disable that rule.", error);
      }
    },
    async deleteRule(input) {
      const resolved = await resolveRuleIdForMutation({
        env,
        action: "delete",
        id: input.id,
        target: input.target,
        type: input.type,
      });
      if (!resolved.ok) return resolved.result;

      try {
        const removed = await removeRulePlaneRule({
          userId: env.runtime.userId,
          id: resolved.id,
        });
        if (!removed.deleted) return failure("Rule not found.");
        return {
          success: true,
          data: removed,
          message: "Rule deleted.",
          meta: { resource: "rule", itemCount: 1 },
        };
      } catch (error) {
        return failure("I couldn't delete that rule.", error);
      }
    },
  };
}
