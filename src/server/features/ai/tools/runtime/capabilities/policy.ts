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
import type { CanonicalRuleType } from "@/server/features/policy-plane/canonical-schema";

function failure(message: string, error?: unknown): ToolResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : undefined,
    message,
  };
}

export interface PolicyCapabilities {
  listRules(input: { type?: CanonicalRuleType }): Promise<ToolResult>;
  compileRule(input: { input: string }): Promise<ToolResult>;
  createRule(input: { input: string; activate?: boolean }): Promise<ToolResult>;
  updateRule(input: { id: string; patch: Record<string, unknown> }): Promise<ToolResult>;
  disableRule(input: { id: string; disabledUntil?: string }): Promise<ToolResult>;
  deleteRule(input: { id: string }): Promise<ToolResult>;
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
      if (!input.id || input.id.trim().length === 0) {
        return {
          success: false,
          error: "missing_rule_id",
          message: "I need a rule id to update it.",
          clarification: {
            kind: "missing_fields",
            prompt: "Which rule id should I update?",
            missingFields: ["rule_id"],
          },
        };
      }
      try {
        const rule = await updateRulePlaneRule({
          userId: env.runtime.userId,
          id: input.id,
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
      if (!input.id || input.id.trim().length === 0) {
        return {
          success: false,
          error: "missing_rule_id",
          message: "I need a rule id to disable it.",
          clarification: {
            kind: "missing_fields",
            prompt: "Which rule id should I disable?",
            missingFields: ["rule_id"],
          },
        };
      }
      try {
        const rule = await disableRulePlaneRule({
          userId: env.runtime.userId,
          id: input.id,
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
      if (!input.id || input.id.trim().length === 0) {
        return {
          success: false,
          error: "missing_rule_id",
          message: "I need a rule id to delete it.",
          clarification: {
            kind: "missing_fields",
            prompt: "Which rule id should I delete?",
            missingFields: ["rule_id"],
          },
        };
      }
      try {
        const removed = await removeRulePlaneRule({
          userId: env.runtime.userId,
          id: input.id,
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
