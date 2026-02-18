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
import prisma from "@/server/db/client";
import type {
  CanonicalRule,
  CanonicalRuleType,
} from "@/server/features/policy-plane/canonical-schema";

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

function scoreRuleMatch(params: {
  normalizedTarget: string;
  targetTokens: Set<string>;
  rule: CanonicalRule;
}): number {
  const text = normalizeText(
    [
      params.rule.name ?? "",
      params.rule.description ?? "",
      params.rule.source.sourceNl ?? "",
    ].join(" "),
  );
  if (!text) return 0;
  if (text.includes(params.normalizedTarget)) return 1;

  const tokens = new Set(text.split(" ").filter(Boolean));
  let hits = 0;
  for (const token of params.targetTokens) {
    if (tokens.has(token)) {
      hits += 1;
      continue;
    }
    // light singular/plural tolerance ("newsletter" vs "newsletters").
    if (token.endsWith("s") && tokens.has(token.slice(0, -1))) {
      hits += 1;
      continue;
    }
    if (!token.endsWith("s") && tokens.has(`${token}s`)) {
      hits += 1;
      continue;
    }
  }
  const denom = Math.max(1, params.targetTokens.size);
  return hits / denom;
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
          prompt: "policy_rule_target_required",
          missingFields: ["rule_target"],
        },
      },
    };
  }

  const allRules = await listRulePlaneRulesByType({
    userId: params.env.runtime.userId,
    emailAccountId: params.env.runtime.emailAccountId,
    type: params.type,
  });
  const rules = allRules;

  if (rules.length === 0) {
    return {
      ok: false,
      result: {
        success: false,
        error: "rule_not_found",
        message: "You don't have any matching rules yet.",
        clarification: {
          kind: "invalid_fields",
          prompt: "policy_rule_target_not_found",
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

  const STOPWORDS = new Set([
    "the",
    "a",
    "an",
    "this",
    "that",
    "these",
    "those",
    "one",
    "rule",
    "rules",
    "please",
    "my",
    "your",
    "it",
    "to",
    "for",
    "of",
    "and",
    "or",
    "in",
    "on",
  ]);
  const targetTokens = new Set(
    normalizedTarget
      .split(" ")
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
  );
  const scored = candidates
    .map((rule) => ({
      rule,
      score: scoreRuleMatch({ normalizedTarget, targetTokens, rule }),
    }))
    .sort((a, b) => b.score - a.score || a.rule.id.localeCompare(b.rule.id));

  const best = scored[0];
  const second = scored[1];
  const bestScore = best?.score ?? 0;
  const secondScore = second?.score ?? 0;

  if (best && bestScore >= 0.75 && bestScore - secondScore >= 0.15) {
    return { ok: true, id: best.rule.id };
  }

  if (bestScore < 0.35) {
    return {
      ok: false,
      result: {
        success: false,
        error: "rule_not_found",
        message: "I couldn't find a matching rule.",
        clarification: {
          kind: "invalid_fields",
          prompt: "policy_rule_target_not_found",
          missingFields: ["rule_target"],
        },
        data: {
          target,
          candidates: candidatePayload.slice(0, 3),
        },
      },
    };
  }

  const topCandidates = scored.slice(0, 3).map((entry) => entry.rule);
  return {
    ok: false,
    result: {
      success: false,
      error: "ambiguous_rule_target",
      message: "I found multiple possible rules.",
      clarification: {
        kind: "invalid_fields",
        prompt: "policy_rule_target_ambiguous",
        missingFields: ["rule_target"],
      },
      data: {
        target,
        candidates: topCandidates.map(summarizeRuleForSelection),
      },
    },
  };
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
  explainLastDecision(input: { limit?: number }): Promise<ToolResult>;
  dryRunRule(input: { id?: string; target?: string; type?: CanonicalRuleType; limit?: number }): Promise<ToolResult>;
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
            prompt: "policy_rule_input_required",
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
            prompt: "policy_rule_input_required",
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
    async explainLastDecision(input) {
      try {
        const limitRaw = typeof input.limit === "number" ? input.limit : undefined;
        const limit = typeof limitRaw === "number" && Number.isFinite(limitRaw)
          ? Math.min(10, Math.max(1, Math.trunc(limitRaw)))
          : 3;

        const logs = await prisma.policyDecisionLog.findMany({
          where: {
            userId: env.runtime.userId,
            emailAccountId: env.runtime.emailAccountId,
            ...(env.runtime.conversationId ? { conversationId: env.runtime.conversationId } : {}),
            decisionKind: { in: ["block", "require_approval"] },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          include: {
            canonicalRule: true,
          },
        });

        if (logs.length === 0) {
          return {
            success: false,
            error: "no_recent_policy_decisions",
            message: "I couldn't find a recent blocked/approval-required action to explain.",
            meta: { resource: "rule", itemCount: 0 },
          };
        }

        const formatted = logs.map((log) => ({
          id: log.id,
          createdAt: log.createdAt.toISOString(),
          toolName: log.toolName,
          decisionKind: log.decisionKind,
          reasonCode: log.reasonCode,
          message: log.message,
          canonicalRule: log.canonicalRule
            ? {
                id: log.canonicalRule.id,
                type: log.canonicalRule.type,
                enabled: log.canonicalRule.enabled,
                name: log.canonicalRule.name ?? null,
                description: log.canonicalRule.description ?? null,
                match: log.canonicalRule.match,
                decision: log.canonicalRule.decision ?? null,
                sourceNl: log.canonicalRule.source?.sourceNl ?? null,
              }
            : null,
        }));

        return {
          success: true,
          data: formatted,
          message: formatted.length === 1 ? "Here's the most recent policy decision." : "Here are the most recent policy decisions.",
          meta: { resource: "rule", itemCount: formatted.length },
        };
      } catch (error) {
        return failure("I couldn't explain the last policy decision right now.", error);
      }
    },

    async dryRunRule(input) {
      const resolved = await resolveRuleIdForMutation({
        env,
        action: "update",
        id: input.id,
        target: input.target,
        type: input.type,
      });
      if (!resolved.ok) return resolved.result;

      try {
        const rules = await listRulePlaneRulesByType({
          userId: env.runtime.userId,
          emailAccountId: env.runtime.emailAccountId,
          type: input.type,
        });
        const rule = rules.find((r) => r.id === resolved.id) ?? null;
        if (!rule) return failure("Rule not found.");

        const limitRaw = typeof input.limit === "number" ? input.limit : undefined;
        const limit = typeof limitRaw === "number" && Number.isFinite(limitRaw)
          ? Math.min(50, Math.max(1, Math.trunc(limitRaw)))
          : 20;

        const unifiedSearch = createUnifiedSearchService({
          userId: env.runtime.userId,
          emailAccountId: env.runtime.emailAccountId,
          email: env.runtime.email,
          logger: env.runtime.logger,
          providers: env.toolContext.providers,
        });

        // Gmail-only pragmatic dry run: use the rule's natural language source as the query.
        // This provides a deterministic, inspectable "what would match" preview.
        const queryText = rule.source?.sourceNl?.trim() || rule.name?.trim() || rule.description?.trim() || "";
        if (!queryText) {
          return {
            success: false,
            error: "rule_missing_source_text",
            message: "That rule doesn't have enough source text to dry-run.",
          };
        }

        const result = await unifiedSearch.query({
          scopes: rule.match.resource === "calendar" ? ["calendar"] : rule.match.resource === "email" ? ["email"] : ["email", "calendar"],
          query: queryText,
          limit,
        });

        return {
          success: true,
          data: {
            rule: summarizeRuleForSelection(rule),
            queryUsed: queryText,
            result,
          },
          message: result.items.length === 0 ? "No current items matched in dry run." : `Dry run found ${result.items.length} matching item${result.items.length === 1 ? "" : "s"}.`,
          meta: { resource: "rule", itemCount: result.items.length },
        };
      } catch (error) {
        return failure("I couldn't dry-run that rule right now.", error);
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
