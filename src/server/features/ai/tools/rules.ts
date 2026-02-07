import { z } from "zod";
import { type ToolDefinition } from "./types";
import prisma from "@/server/db/client";
import { createRuleSchema } from "@/features/rules/ai/prompts/create-rule-schema";
import { createRule, partialUpdateRule, updateRule, updateRuleActions } from "@/features/rules/rule";
import { saveLearnedPatterns } from "@/features/rules/learned-patterns";
import { GroupItemType, LogicalOperator, ActionType } from "@/generated/prisma/enums";
import { delayInMinutesSchema } from "@/actions/rule.validation";
import { filterNullProperties } from "@/server/lib";
import { isMicrosoftProvider } from "@/features/email/provider-types";

const actionSchema = z.enum([
  "list",
  "get_patterns",
  "create",
  "update_conditions",
  "update_actions",
  "update_patterns",
  "update_about",
  "add_knowledge",
]);

const updateRuleConditionSchema = z.object({
  ruleName: z.string(),
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
    group: z.string().nullish(),
  }),
});

const updateRuleActionSchema = z.object({
  ruleName: z.string(),
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
        payload: z.unknown().nullish(),
      }),
      delayInMinutes: delayInMinutesSchema,
    }),
  ),
});

const updateLearnedPatternsSchema = z.object({
  ruleName: z.string(),
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
    .min(1),
});

const updateAboutSchema = z.object({
  about: z.string().min(1),
});

const addKnowledgeSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});

const rulesToolParameters = z.object({
  action: actionSchema,
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const rulesTool: ToolDefinition<typeof rulesToolParameters> = {
  name: "rules",
  description: `Manage email rules. Actions: list, create, update_conditions, update_actions, update_patterns, get_patterns, update_about, add_knowledge.
Rule structure: condition (aiInstructions and/or static from/to/subject) + actions (archive, label, draft, reply, send, mark read, etc.). Static conditions use AND; top-level conditions can use AND/OR (conditionalOperator). Use {{variables}} in action fields for AI-generated content. Prefer short rule names (e.g. Newsletters, Urgent). Check if a rule already exists before creating.`,
  parameters: rulesToolParameters,
  securityLevel: "CAUTION",
  execute: async ({ action, payload }, context) => {
    const emailAccount = await prisma.emailAccount.findUnique({
      where: { id: context.emailAccountId },
      include: { account: true },
    });
    if (!emailAccount) {
      return { success: false, error: "Email account not found" };
    }

    const provider = emailAccount.account?.provider || "google";

    switch (action) {
      case "list": {
        const account = await prisma.emailAccount.findUnique({
          where: { id: context.emailAccountId },
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
                group: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        });

        return {
          success: true,
          data: {
            about: account?.about || "Not set",
            rules:
              account?.rules.map((rule) => {
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
                    group: rule.group?.name,
                  },
                  actions: rule.actions.map((actionItem) => ({
                    type: actionItem.type,
                    fields: filterNullProperties({
                      label: actionItem.label,
                      content: actionItem.content,
                      to: actionItem.to,
                      cc: actionItem.cc,
                      bcc: actionItem.bcc,
                      subject: actionItem.subject,
                      url: actionItem.url,
                      folderName: actionItem.folderName,
                    }),
                  })),
                  enabled: rule.enabled,
                  runOnThreads: rule.runOnThreads,
                };
              }) ?? [],
          },
        };
      }
      case "get_patterns": {
        const ruleName = payload?.ruleName as string | undefined;
        if (!ruleName) {
          return { success: false, error: "ruleName is required" };
        }
        const rule = await prisma.rule.findUnique({
          where: {
            name_emailAccountId: {
              name: ruleName,
              emailAccountId: context.emailAccountId,
            },
          },
          select: {
            group: {
              select: {
                items: { select: { type: true, value: true, exclude: true } },
              },
            },
          },
        });
        if (!rule) {
          return {
            success: false,
            error:
              "Rule not found. Try listing the rules again. The user may have made changes since you last checked.",
          };
        }
        return { success: true, data: { patterns: rule.group?.items } };
      }
      case "create": {
        const parsed = createRuleSchema(provider).safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const args = parsed.data;
        const rule = await createRule({
          result: {
            name: args.name,
            ruleId: undefined,
            condition: args.condition,
            actions: args.actions.map((actionItem) => ({
              type: actionItem.type,
              fields: actionItem.fields
                ? {
                    content: actionItem.fields.content ?? null,
                    to: actionItem.fields.to ?? null,
                    subject: actionItem.fields.subject ?? null,
                    label: actionItem.fields.label ?? null,
                    webhookUrl: actionItem.fields.webhookUrl ?? null,
                    cc: actionItem.fields.cc ?? null,
                    bcc: actionItem.fields.bcc ?? null,
                    payload: actionItem.fields.payload ?? null,
                    ...(isMicrosoftProvider(provider) && {
                      folderName: actionItem.fields.folderName ?? null,
                    }),
                  }
                : null,
            })),
          },
          emailAccountId: context.emailAccountId,
          provider,
          runOnThreads: true,
          logger: context.logger,
        });
        return { success: true, data: { ruleId: rule.id } };
      }
      case "update_conditions": {
        const parsed = updateRuleConditionSchema.safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const { ruleName, condition } = parsed.data;
        const rule = await prisma.rule.findUnique({
          where: {
            name_emailAccountId: {
              name: ruleName,
              emailAccountId: context.emailAccountId,
            },
          },
          select: {
            id: true,
            instructions: true,
            from: true,
            to: true,
            subject: true,
            conditionalOperator: true,
            group: {
              select: {
                name: true,
              },
            },
          },
        });
        if (!rule) {
          return {
            success: false,
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
          group: rule.group?.name,
        };
        const groupId = await resolveGroupId({
          emailAccountId: context.emailAccountId,
          groupName: condition.group,
        });
        await partialUpdateRule({
          ruleId: rule.id,
          data: {
            instructions: condition.aiInstructions,
            from: condition.static?.from,
            to: condition.static?.to,
            subject: condition.static?.subject,
            conditionalOperator: condition.conditionalOperator ?? undefined,
            ...(groupId !== undefined && { groupId }),
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
          group: condition.group,
        };
        return {
          success: true,
          data: { ruleId: rule.id, originalConditions, updatedConditions },
        };
      }
      case "update_actions": {
        const parsed = updateRuleActionSchema.safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const { ruleName, actions } = parsed.data;
        const rule = await prisma.rule.findUnique({
          where: {
            name_emailAccountId: {
              name: ruleName,
              emailAccountId: context.emailAccountId,
            },
          },
          select: {
            id: true,
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
                payload: true,
              },
            },
          },
        });
        if (!rule) {
          return {
            success: false,
            error:
              "Rule not found. Try listing the rules again. The user may have made changes since you last checked.",
          };
        }
        const originalActions = rule.actions.map((actionItem) => ({
          type: actionItem.type,
          fields: filterNullProperties({
            label: actionItem.label,
            content: actionItem.content,
            to: actionItem.to,
            cc: actionItem.cc,
            bcc: actionItem.bcc,
            subject: actionItem.subject,
            webhookUrl: actionItem.url,
            payload: actionItem.payload,
            ...(isMicrosoftProvider(provider) && {
              folderName: actionItem.folderName,
            }),
          }),
        }));
        await updateRuleActions({
          ruleId: rule.id,
          actions: actions.map((actionItem) => ({
            type: actionItem.type,
            fields: {
              label: actionItem.fields?.label ?? null,
              to: actionItem.fields?.to ?? null,
              cc: actionItem.fields?.cc ?? null,
              bcc: actionItem.fields?.bcc ?? null,
              subject: actionItem.fields?.subject ?? null,
              content: actionItem.fields?.content ?? null,
              webhookUrl: actionItem.fields?.webhookUrl ?? null,
              payload: actionItem.fields?.payload ?? null,
              ...(isMicrosoftProvider(provider) && {
                folderName: actionItem.fields?.folderName ?? null,
              }),
            },
            delayInMinutes: actionItem.delayInMinutes ?? null,
          })),
          provider,
          emailAccountId: context.emailAccountId,
          logger: context.logger,
        });
        return {
          success: true,
          data: { ruleId: rule.id, originalActions, updatedActions: actions },
        };
      }
      case "update_patterns": {
        const parsed = updateLearnedPatternsSchema.safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const { ruleName, learnedPatterns } = parsed.data;
        const patterns = learnedPatterns.flatMap((pattern) => {
          const entries: Array<{
            type: GroupItemType;
            value: string;
            exclude?: boolean;
          }> = [];
          if (pattern.include?.from) {
            entries.push({
              type: GroupItemType.FROM,
              value: pattern.include.from,
              exclude: false,
            });
          }
          if (pattern.include?.subject) {
            entries.push({
              type: GroupItemType.SUBJECT,
              value: pattern.include.subject,
              exclude: false,
            });
          }
          if (pattern.exclude?.from) {
            entries.push({
              type: GroupItemType.FROM,
              value: pattern.exclude.from,
              exclude: true,
            });
          }
          if (pattern.exclude?.subject) {
            entries.push({
              type: GroupItemType.SUBJECT,
              value: pattern.exclude.subject,
              exclude: true,
            });
          }
          return entries;
        });
        const result = await saveLearnedPatterns({
          emailAccountId: context.emailAccountId,
          ruleName,
          patterns,
          logger: context.logger,
        });
        if ("error" in result) {
          return { success: false, error: result.error };
        }
        return { success: true, data: { ruleName } };
      }
      case "update_about": {
        const parsed = updateAboutSchema.safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        await prisma.emailAccount.update({
          where: { id: context.emailAccountId },
          data: { about: parsed.data.about },
        });
        return { success: true, data: { about: parsed.data.about } };
      }
      case "add_knowledge": {
        const parsed = addKnowledgeSchema.safeParse(payload);
        if (!parsed.success) {
          return { success: false, error: "Invalid payload", data: parsed.error };
        }
        const knowledge = await prisma.knowledge.create({
          data: {
            emailAccountId: context.emailAccountId,
            title: parsed.data.title,
            content: parsed.data.content,
          },
        });
        return { success: true, data: knowledge };
      }
      default:
        return { success: false, error: "Unsupported action" };
    }
  },
};

async function resolveGroupId({
  emailAccountId,
  groupName,
}: {
  emailAccountId: string;
  groupName?: string | null;
}): Promise<string | null | undefined> {
  if (groupName === null) return null;
  if (!groupName) return undefined;

  const group = await prisma.group.findFirst({
    where: {
      emailAccountId,
      name: groupName,
    },
  });

  if (!group) {
    throw new Error(`Group not found: ${groupName}`);
  }

  return group.id;
}
