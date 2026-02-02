/**
 * Shared rule management tools used by both web-chat and surfaces agents
 */
import { tool } from "ai";
import { z } from "zod";
import type { Logger } from "@/server/lib/logger";
import { createRuleSchema } from "@/features/rules/ai/prompts/create-rule-schema";
import prisma from "@/server/db/client";
import { isDuplicateError } from "@/server/db/client-helpers";
import { EmbeddingService } from "@/features/memory/embeddings/service";
import {
  createRule,
  partialUpdateRule,
  updateRuleActions,
} from "@/features/rules/rule";
import {
  ActionType,
  GroupItemType,
  LogicalOperator,
} from "@/generated/prisma/enums";
import { saveLearnedPatterns } from "@/features/rules/learned-patterns";
import { posthogCaptureEvent } from "@/server/lib/posthog";
import { filterNullProperties } from "@/server/lib";
import { delayInMinutesSchema } from "@/actions/rule.validation";
import { isMicrosoftProvider } from "@/features/email/provider-types";

export interface RuleToolOptions {
  email: string;
  emailAccountId: string;
  provider: string;
  logger: Logger;
}

async function trackToolCall({
  tool,
  email,
  logger,
}: {
  tool: string;
  email: string;
  logger: Logger;
}) {
  logger.info("Tracking tool call", { tool, email });
  return posthogCaptureEvent(email, "AI Assistant Chat Tool Call", { tool });
}

export const getUserRulesAndSettingsTool = ({
  email,
  emailAccountId,
  logger,
}: Omit<RuleToolOptions, "provider">) =>
  tool({
    name: "getUserRulesAndSettings",
    description:
      "Retrieve all existing rules for the user, their about information",
    parameters: z.object({}),
    execute: async (_args: {}) => {
      trackToolCall({
        tool: "get_user_rules_and_settings",
        email,
        logger,
      });

      const emailAccount = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        select: {
          about: true,
          rules: {
            select: {
              name: true,
              instructions: true,
              from: true,
              to: true,
              subject: true,
              conditionalOperator: true,
              enabled: true,
              runOnThreads: true,
              actions: {
                select: {
                  type: true,
                  content: true,
                  label: true,
                  to: true,
                  cc: true,
                  bcc: true,
                  subject: true,
                  url: true,
                  folderName: true,
                },
              },
            },
          },
        },
      });

      return {
        about: emailAccount?.about || "Not set",
        rules: emailAccount?.rules.map((rule) => {
          const staticFilter = filterNullProperties({
            from: rule.from,
            to: rule.to,
            subject: rule.subject,
          });

          const staticConditions =
            Object.keys(staticFilter).length > 0 ? staticFilter : undefined;

          return {
            name: rule.name,
            conditions: {
              aiInstructions: rule.instructions,
              static: staticConditions,
              conditionalOperator:
                rule.instructions && staticConditions
                  ? rule.conditionalOperator
                  : undefined,
            },
            actions: rule.actions.map((action) => ({
              type: action.type,
              fields: filterNullProperties({
                label: action.label,
                content: action.content,
                to: action.to,
                cc: action.cc,
                bcc: action.bcc,
                subject: action.subject,
                url: action.url,
                folderName: action.folderName,
              }),
            })),
            enabled: rule.enabled,
            runOnThreads: rule.runOnThreads,
          };
        }),
      };
    },
  } as any);

export const getLearnedPatternsTool = ({
  email,
  emailAccountId,
  logger,
}: Omit<RuleToolOptions, "provider">) =>
  tool({
    name: "getLearnedPatterns",
    description: "Retrieve the learned patterns for a rule",
    parameters: z.object({
      ruleName: z
        .string()
        .describe("The name of the rule to get the learned patterns for"),
    }),
    execute: async (args: { ruleName: string }) => {
      const { ruleName } = args;
      trackToolCall({ tool: "get_learned_patterns", email, logger });

      const rule = await prisma.rule.findUnique({
        where: { name_emailAccountId: { name: ruleName, emailAccountId } },
        select: {
          group: {
            select: {
              items: {
                select: {
                  type: true,
                  value: true,
                  exclude: true,
                },
              },
            },
          },
        },
      });

      if (!rule) {
        return {
          error:
            "Rule not found. Try listing the rules again. The user may have made changes since you last checked.",
        };
      }

      return {
        patterns: rule.group?.items,
      };
    },
  } as any);

export const createRuleTool = ({
  email,
  emailAccountId,
  provider,
  logger,
}: RuleToolOptions) =>
  tool({
    name: "createRule",
    description: "Create a new rule",
    parameters: createRuleSchema(provider),
    execute: async (args: z.infer<ReturnType<typeof createRuleSchema>>) => {
      const { name, condition, actions } = args;
      trackToolCall({ tool: "create_rule", email, logger });

      try {
        const rule = await createRule({
          result: {
            name,
            ruleId: undefined,
            condition,
            actions: actions.map((action: any) => ({
              type: action.type,
              fields: action.fields
                ? {
                    content: action.fields.content ?? null,
                    to: action.fields.to ?? null,
                    subject: action.fields.subject ?? null,
                    label: action.fields.label ?? null,
                    webhookUrl: action.fields.webhookUrl ?? null,
                    cc: action.fields.cc ?? null,
                    bcc: action.fields.bcc ?? null,
                    ...(isMicrosoftProvider(provider) && {
                      folderName: action.fields.folderName ?? null,
                    }),
                  }
                : null,
            })),
          },
          emailAccountId,
          provider,
          runOnThreads: true,
          logger,
        });

        return { success: true, ruleId: rule.id };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Failed to create rule", { error });
        return { error: "Failed to create rule", message };
      }
    },
  } as any);

const updateRuleConditionSchema = z.object({
  ruleName: z.string().describe("The name of the rule to update"),
  condition: z.object({
    aiInstructions: z.string().optional(),
    static: z
      .object({
        from: z.string().nullish(),
        to: z.string().nullish(),
        subject: z.string().nullish(),
      })
      .nullish(),
    conditionalOperator: z
      .enum([LogicalOperator.AND, LogicalOperator.OR])
      .nullish(),
  }),
});

export const updateRuleConditionsTool = ({
  email,
  emailAccountId,
  logger,
}: Omit<RuleToolOptions, "provider">) =>
  tool({
    name: "updateRuleConditions",
    description: "Update the conditions of an existing rule",
    parameters: updateRuleConditionSchema,
    execute: async (args: z.infer<typeof updateRuleConditionSchema>) => {
      const { ruleName, condition } = args;
      trackToolCall({ tool: "update_rule_conditions", email, logger });

      const rule = await prisma.rule.findUnique({
        where: { name_emailAccountId: { name: ruleName, emailAccountId } },
        select: {
          id: true,
          name: true,
          instructions: true,
          from: true,
          to: true,
          subject: true,
          conditionalOperator: true,
        },
      });

      if (!rule) {
        return {
          success: false,
          ruleId: "",
          error:
            "Rule not found. Try listing the rules again. The user may have made changes since you last checked.",
        };
      }

      const originalConditions = {
        aiInstructions: rule.instructions,
        static: filterNullProperties({
          from: rule.from,
          to: rule.to,
          subject: rule.subject,
        }),
        conditionalOperator: rule.conditionalOperator,
      };

      await partialUpdateRule({
        ruleId: rule.id,
        data: {
          instructions: condition.aiInstructions,
          from: condition.static?.from,
          to: condition.static?.to,
          subject: condition.static?.subject,
          conditionalOperator: condition.conditionalOperator ?? undefined,
        },
      });

      const updatedConditions = {
        aiInstructions: condition.aiInstructions,
        static: condition.static
          ? filterNullProperties({
              from: condition.static.from,
              to: condition.static.to,
              subject: condition.static.subject,
            })
          : undefined,
        conditionalOperator: condition.conditionalOperator,
      };

      return {
        success: true,
        ruleId: rule.id,
        originalConditions,
        updatedConditions,
      };
    },
  } as any);

const updateRuleActionSchema = z.object({
  ruleName: z.string().describe("The name of the rule to update"),
  actions: z.array(
    z.object({
      type: z.enum([
        ActionType.ARCHIVE,
        ActionType.LABEL,
        ActionType.DRAFT_EMAIL,
        ActionType.FORWARD,
        ActionType.REPLY,
        ActionType.SEND_EMAIL,
        ActionType.MARK_READ,
        ActionType.MARK_SPAM,
        ActionType.CALL_WEBHOOK,
        ActionType.DIGEST,
      ]),
      fields: z.object({
        label: z.string().nullish(),
        content: z.string().nullish(),
        webhookUrl: z.string().nullish(),
        to: z.string().nullish(),
        cc: z.string().nullish(),
        bcc: z.string().nullish(),
        subject: z.string().nullish(),
        folderName: z.string().nullish(),
      }),
      delayInMinutes: delayInMinutesSchema,
    }),
  ),
});

export const updateRuleActionsTool = ({
  email,
  emailAccountId,
  provider,
  logger,
}: RuleToolOptions) =>
  tool({
    name: "updateRuleActions",
    description:
      "Update the actions of an existing rule. This replaces the existing actions.",
    parameters: updateRuleActionSchema,
    execute: async (args: z.infer<typeof updateRuleActionSchema>) => {
      const { ruleName, actions } = args;
      trackToolCall({ tool: "update_rule_actions", email, logger });
      
      const rule = await prisma.rule.findUnique({
        where: { name_emailAccountId: { name: ruleName, emailAccountId } },
        select: {
          id: true,
          name: true,
          actions: {
            select: {
              type: true,
              content: true,
              label: true,
              to: true,
              cc: true,
              bcc: true,
              subject: true,
              url: true,
              folderName: true,
            },
          },
        },
      });

      if (!rule) {
        return {
          success: false,
          ruleId: "",
          error:
            "Rule not found. Try listing the rules again. The user may have made changes since you last checked.",
        };
      }

      const originalActions = rule.actions.map((action) => ({
        type: action.type,
        fields: filterNullProperties({
          label: action.label,
          content: action.content,
          to: action.to,
          cc: action.cc,
          bcc: action.bcc,
          subject: action.subject,
          webhookUrl: action.url,
          ...(isMicrosoftProvider(provider) && {
            folderName: action.folderName,
          }),
        }),
      }));

      await updateRuleActions({
        ruleId: rule.id,
        actions: actions.map((action: any) => ({
          type: action.type,
          fields: {
            label: action.fields?.label ?? null,
            to: action.fields?.to ?? null,
            cc: action.fields?.cc ?? null,
            bcc: action.fields?.bcc ?? null,
            subject: action.fields?.subject ?? null,
            content: action.fields?.content ?? null,
            webhookUrl: action.fields?.webhookUrl ?? null,
            ...(isMicrosoftProvider(provider) && {
              folderName: action.fields?.folderName ?? null,
            }),
          },
          delayInMinutes: action.delayInMinutes ?? null,
        })),
        provider,
        emailAccountId,
        logger,
      });

      return {
        success: true,
        ruleId: rule.id,
        originalActions,
        updatedActions: actions,
      };
    },
  } as any);

const updateLearnedPatternsSchema = z.object({
  ruleName: z.string().describe("The name of the rule to update"),
  learnedPatterns: z
    .array(
      z.object({
        include: z
          .object({
            from: z.string().optional(),
            subject: z.string().optional(),
          })
          .optional(),
        exclude: z
          .object({
            from: z.string().optional(),
            subject: z.string().optional(),
          })
          .optional(),
      }),
    )
    .min(1, "At least one learned pattern is required"),
});

export const updateLearnedPatternsTool = ({
  email,
  emailAccountId,
  logger,
}: Omit<RuleToolOptions, "provider">) =>
  tool({
    name: "updateLearnedPatterns",
    description: "Update the learned patterns of an existing rule",
    parameters: updateLearnedPatternsSchema,
    execute: async (args: z.infer<typeof updateLearnedPatternsSchema>) => {
      const { ruleName, learnedPatterns } = args;
      trackToolCall({ tool: "update_learned_patterns", email, logger });

      const rule = await prisma.rule.findUnique({
        where: { name_emailAccountId: { name: ruleName, emailAccountId } },
      });

      if (!rule) {
        return {
          success: false,
          ruleId: "",
          error:
            "Rule not found. Try listing the rules again. The user may have made changes since you last checked.",
        };
      }

      const patternsToSave: Array<{
        type: GroupItemType;
        value: string;
        exclude?: boolean;
      }> = [];

      for (const pattern of learnedPatterns) {
        if (pattern.include?.from) {
          patternsToSave.push({
            type: GroupItemType.FROM,
            value: pattern.include.from,
            exclude: false,
          });
        }

        if (pattern.include?.subject) {
          patternsToSave.push({
            type: GroupItemType.SUBJECT,
            value: pattern.include.subject,
            exclude: false,
          });
        }

        if (pattern.exclude?.from) {
          patternsToSave.push({
            type: GroupItemType.FROM,
            value: pattern.exclude.from,
            exclude: true,
          });
        }

        if (pattern.exclude?.subject) {
          patternsToSave.push({
            type: GroupItemType.SUBJECT,
            value: pattern.exclude.subject,
            exclude: true,
          });
        }
      }

      if (patternsToSave.length > 0) {
        await saveLearnedPatterns({
          emailAccountId,
          ruleName: rule.name,
          patterns: patternsToSave,
          logger,
        });
      }

      return { success: true, ruleId: rule.id };
    },
  } as any);

export const updateAboutTool = ({
  email,
  emailAccountId,
  logger,
}: Omit<RuleToolOptions, "provider">) =>
  tool({
    name: "updateAbout",
    description:
      "Update the user's about information. Read the user's about information first as this replaces the existing information.",
    parameters: z.object({ about: z.string() }),
    execute: async (args: { about: string }) => {
      const { about } = args;
      trackToolCall({ tool: "update_about", email, logger });
      
      const existing = await prisma.emailAccount.findUnique({
        where: { id: emailAccountId },
        select: { about: true },
      });

      if (!existing) return { error: "Account not found" };

      await prisma.emailAccount.update({
        where: { id: emailAccountId },
        data: { about },
      });

      return {
        success: true,
        previousAbout: existing.about,
        updatedAbout: about,
      };
    },
  } as any);

export const addToKnowledgeBaseTool = ({
  email,
  emailAccountId,
  logger,
}: Omit<RuleToolOptions, "provider">) =>
  tool({
    name: "addToKnowledgeBase",
    description: "Add content to the knowledge base",
    parameters: z.object({
      title: z.string(),
      content: z.string(),
    }),
    execute: async (args: { title: string; content: string }) => {
      const { title, content } = args;
      trackToolCall({ tool: "add_to_knowledge_base", email, logger });

      try {
        const knowledge = await prisma.knowledge.create({
          data: {
            emailAccountId,
            title,
            content,
          },
        });

        // Generate and store embedding (fire and forget to avoid blocking)
        if (EmbeddingService.isAvailable()) {
          (async () => {
            try {
              const embedding = await EmbeddingService.generateEmbedding(`${title}\n\n${content}`);
              // Use raw SQL since Prisma doesn't support pgvector natively
              await prisma.$executeRaw`
                UPDATE "Knowledge" 
                SET embedding = ${embedding}::vector 
                WHERE id = ${knowledge.id}
              `;
              logger.info("Embedding generated for knowledge", { knowledgeId: knowledge.id });
            } catch (e) {
              logger.warn("Failed to generate embedding for knowledge", { error: e, knowledgeId: knowledge.id });
            }
          })();
        }

        return { success: true };
      } catch (error) {
        if (isDuplicateError(error, "title")) {
          return {
            error: "A knowledge item with this title already exists",
          };
        }

        logger.error("Failed to add to knowledge base", { error });
        return { error: "Failed to add to knowledge base" };
      }
    },
  } as any);

/**
 * Creates all rule management tools with the given options
 */
export function createRuleManagementTools(options: RuleToolOptions) {
  return {
    getUserRulesAndSettings: getUserRulesAndSettingsTool(options),
    getLearnedPatterns: getLearnedPatternsTool(options),
    createRule: createRuleTool(options),
    updateRuleConditions: updateRuleConditionsTool(options),
    updateRuleActions: updateRuleActionsTool(options),
    updateLearnedPatterns: updateLearnedPatternsTool(options),
    updateAbout: updateAboutTool(options),
    addToKnowledgeBase: addToKnowledgeBaseTool(options),
  };
}
