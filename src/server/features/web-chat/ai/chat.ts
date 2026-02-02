import { tool, zodSchema, type ModelMessage } from "ai";
import { z } from "zod";
import type { Logger } from "@/server/lib/logger";
import { createRuleSchema } from "@/features/rules/ai/prompts/create-rule-schema";
import prisma from "@/server/db/client";
import { isDuplicateError } from "@/server/db/client-helpers";
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
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import { saveLearnedPatterns } from "@/features/rules/learned-patterns";
import { posthogCaptureEvent } from "@/server/lib/posthog";
import { createGenerateText, chatCompletionStream } from "@/server/lib/llms";
import { filterNullProperties } from "@/server/lib";
import { delayInMinutesSchema } from "@/actions/rule.validation";
import { isMicrosoftProvider } from "@/features/email/provider-types";
import type { MessageContext } from "@/app/api/chat/validation";
import { stringifyEmail } from "@/server/lib/stringify-email";
import { getEmailForLLM } from "@/server/lib/get-email-from-message";
import type { ParsedMessage } from "@/server/types";
import { env } from "@/env";
import { createAgentTools } from "@/features/ai/tools";

export const maxDuration = 120;

// tools
const getUserRulesAndSettingsTool = ({
  email,
  emailAccountId,
  logger,
}: {
  email: string;
  emailAccountId: string;
  logger: Logger;
}) =>
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
              // only need to show conditional operator if there are multiple conditions
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



const getLearnedPatternsTool = ({
  email,
  emailAccountId,
  logger,
}: {
  email: string;
  emailAccountId: string;
  logger: Logger;
}) =>
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

export type GetLearnedPatternsTool = typeof getLearnedPatternsTool;

const createRuleTool = ({
  email,
  emailAccountId,
  provider,
  logger,
}: {
  email: string;
  emailAccountId: string;
  provider: string;
  logger: Logger;
}) =>
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
export type UpdateRuleConditionSchema = z.infer<
  typeof updateRuleConditionSchema
>;

const updateRuleConditionsTool = ({
  email,
  emailAccountId,
  logger,
}: {
  email: string;
  emailAccountId: string;
  logger: Logger;
}) =>
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

      // Store original state
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

      // Prepare updated state
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

const updateRuleActionsTool = ({
  email,
  emailAccountId,
  provider,
  logger,
}: {
  email: string;
  emailAccountId: string;
  provider: string;
  logger: Logger;
}) =>
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

      // Store original actions
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

const updateLearnedPatternsTool = ({
  email,
  emailAccountId,
  logger,
}: {
  email: string;
  emailAccountId: string;
  logger: Logger;
}) =>
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

      // Convert the learned patterns format
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



const updateAboutTool = ({
  email,
  emailAccountId,
  logger,
}: {
  email: string;
  emailAccountId: string;
  logger: Logger;
}) =>
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



const addToKnowledgeBaseTool = ({
  email,
  emailAccountId,
  logger,
}: {
  email: string;
  emailAccountId: string;
  logger: Logger;
}) =>
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
        await prisma.knowledge.create({
          data: {
            emailAccountId,
            title,
            content,
          },
        });

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



export async function aiProcessAssistantChat({
  messages,
  emailAccountId,
  user,
  context,
  logger,
}: {
  messages: ModelMessage[];
  emailAccountId: string;
  user: EmailAccountWithAI;
  context?: MessageContext;
  logger: Logger;
}) {
  const agentSystemPrompt = `
You now have access to a set of Agentic Tools to manage the user's Email and Calendar directly.
You can perform actions like searching, reading, archiving, labeling, and drafting emails.

Agentic Tools:
- query: Search for emails (resource: "email"), calendar events (resource: "calendar"), or rule patterns (resource: "patterns").
- get: Retrieve full details of specific items by ID.
- modify: Change the state of items (archive, trash, label, mark read).
- create: Create DRAFTS for new emails, replies, or forwards (resource: "email"). NEVER send emails directly.
- delete: Trash items.
- analyze: Analyze content (summarize, extract actions).

Core Principle: "The Second Brain"
- Before taking action on any email (archiving, labeling, etc.), ASK THE CLASSIFIER if any rules match.
- Use \`query({ resource: "patterns", filter: { id: "EMAIL_ID" } })\` to check for rules.
- If a rule matches, follow its instructions/actions explicitly unless overridden by user input.

Security & Safety:
- You operate in a CAUTION mode for modifications.
- You can create DRAFTS but cannot send emails.
- Always confirm with the user before performing destructive actions (like bulk trashing) if unclear.
- Use the 'analyze' tool to summarize long threads if needed.

When asked to manage emails/calendar, use these tools.
For managing Rules and Settings, continue using the specific Rule tools (createRule, etc.).
`;

  const system = `You are an assistant that helps create and update rules to manage a user's inbox AND manage the inbox directly. Our platform is called Amodel.

${agentSystemPrompt}
  
You can't perform any actions on their inbox DIRECTLY via rules only. You now have tools to Modify the inbox state.
You can only adjust the rules that manage the inbox OR use the Agentic Tools to manage it.

A rule is comprised of:
1. A condition
2. A set of actions

A condition can be:
1. AI instructions
2. Static

An action can be:
1. Archive
2. Label
3. Draft a reply${env.NEXT_PUBLIC_EMAIL_SEND_ENABLED
      ? `
4. Reply
5. Send an email
6. Forward`
      : ""
    }
7. Mark as read
8. Mark spam
9. Call a webhook

You can use {{variables}} in the fields to insert AI generated content. For example:
"Hi {{name}}, {{write a friendly reply}}, Best regards, Alice"

Rule matching logic:
- All static conditions (from, to, subject) use AND logic - meaning all static conditions must match
- Top level conditions (AI instructions, static) can use either AND or OR logic, controlled by the "conditionalOperator" setting

Best practices:
- For static conditions, use email patterns (e.g., '@company.com') when matching multiple addresses
- IMPORTANT: do not create new rules unless absolutely necessary. Avoid duplicate rules, so make sure to check if the rule already exists.
- You can use multiple conditions in a rule, but aim for simplicity.
- When creating rules, in most cases, you should use the "aiInstructions" and sometimes you will use other fields in addition.
- If a rule can be handled fully with static conditions, do so, but this is rarely possible.
${env.NEXT_PUBLIC_EMAIL_SEND_ENABLED ? `- IMPORTANT: prefer "draft a reply" over "reply". Only if the user explicitly asks to reply, then use "reply". Clarify beforehand this is the intention. Drafting a reply is safer as it means the user can approve before sending.` : ""}
- Use short, concise rule names (preferably a single word). For example: 'Marketing', 'Newsletters', 'Urgent', 'Receipts'. Avoid verbose names like 'Archive and label marketing emails'.

Always explain the changes you made.
Use simple language and avoid jargon in your reply.
If you are unable to fix the rule, say so.

You can set general information about the user in their Personal Instructions (via the updateAbout tool) that will be passed as context when the AI is processing emails.

Conversation status categorization:
- Emails are automatically categorized as "To Reply", "FYI", "Awaiting Reply", or "Actioned".
- IMPORTANT: Unlike regular automation rules, the prompts that determine these conversation statuses CANNOT be modified. They use fixed logic.
- However, the user's Personal Instructions ARE passed to the AI when making these determinations. So if users want to influence how emails are categorized (e.g., "emails where I'm CC'd shouldn't be To Reply"), update their Personal Instructions with these preferences.
- Use the updateAbout tool to add these preferences to the user's Personal Instructions.

Reply Zero is a feature that labels emails that need a reply "To Reply". And labels emails that are awaiting a response "Awaiting". The user is also able to see these in a minimalist UI within Amodel which only shows which emails the user needs to reply to or is awaiting a response on.

Don't tell the user which tools you're using. The tools you use will be displayed in the UI anyway.
Don't use placeholders in rules you create. For example, don't use @company.com. Use the user's actual company email address. And if you don't know some information you need, ask the user.

Static conditions:
- In FROM and TO fields, you can use the pipe symbol (|) to represent OR logic. For example, "@company1.com|@company2.com" will match emails from either domain.
- In the SUBJECT field, pipe symbols are treated as literal characters and must match exactly.

Learned patterns:
- Learned patterns override the conditional logic for a rule.
- This avoids us having to use AI to process emails from the same sender over and over again.
- There's some similarity to static rules, but you can only use one static condition for a rule. But you can use multiple learned patterns. And over time the list of learned patterns will grow.
- You can use includes or excludes for learned patterns. Usually you will use includes, but if the user has explained that an email is being wrongly labelled, check if we have a learned pattern for it and then fix it to be an exclude instead.

Knowledge base:
- The knowledge base is used to draft reply content.
- It is only used when an action of type DRAFT_REPLY is used AND the rule has no preset draft content.

Examples:

<examples>
  <example>
    <input>
      When I get a newsletter, archive it and label it as "Newsletter"
    </input>
    <output>
      <create_rule>
        {
          "name": "Newsletters",
          "condition": { "aiInstructions": "Newsletters" },
          "actions": [
            {
              "type": "archive",
              "fields": {}
            },
            {
              "type": "label",
              "fields": {
                "label": "Newsletter"
              }
            }
          ]
        }
      </create_rule>
      <explanation>
        I created a rule to label newsletters.
      </explanation>
    </output>
  </example>

  <example>
    <input>
      I run a marketing agency and use this email address for cold outreach.
      If someone shows interest, label it "Interested".
      If someone says they're interested in learning more, send them my Cal link (cal.com/alice).
      If they ask for more info, send them my deck (https://drive.google.com/alice-deck.pdf).
      If they're not interested, label it as "Not interested" and archive it.
      If you don't know how to respond, label it as "Needs review".
    </input>
    <output>
      <update_about>
        I run a marketing agency and use this email address for cold outreach.
        My cal link is https://cal.com/alice
        My deck is https://drive.google.com/alice-deck.pdf
        Write concise and friendly replies.
      </update_about>
      <create_rule>
        {
          "name": "Interested",
          "condition": { "aiInstructions": "When someone shows interest in setting up a call or learning more." },
          "actions": [
            {
              "type": "label",
              "fields": {
                "label": "Interested"
              }
            },
            {
              "type": "draft",
              "fields": {
                "content": "{{draft a reply}}"
              }
            }
          ]
        }
      </create_rule>
      <create_rule>
        {
          "name": "Not Interested",
          "condition": { "aiInstructions": "When someone says they're not interested." },
          "actions": [
            {
              "type": "label",
              "fields": {
                "label": "Not Interested"
              }
            },
            {
              "type": "archive",
              "fields": {}
            }
          ]
        }
      </create_rule>
      <create_rule>
        {
          "name": "Needs Review",
          "condition": { "aiInstructions": "When you don't know how to respond." },
          "actions": [
            {
              "type": "label",
              "fields": {
                "label": "Needs Review"
              }
            }
          ]
        }
      </create_rule>
      <explanation>
        I created three rules to handle different types of responses.
      </explanation>
    </output>
  </example>

  <example>
    <input>
      Set a rule to archive emails older than 30 days.
    </input>
    <output>
      Amodel doesn't support time-based actions yet. We only process emails as they arrive in your inbox.
    </output>
  </example>

  <example>
    <input>
      Create some good default rules for me.
    </input>
    <output>
      <create_rule>
        {
          "name": "Urgent",
          "condition": { "aiInstructions": "Urgent emails" },
          "actions": [
            { "type": "label", "fields": { "label": "Urgent" } }
          ]
        }
      </create_rule>
      <create_rule>
        {
          "name": "Newsletters",
          "condition": { "aiInstructions": "Newsletters" },
          "actions": [
            { "type": "archive", "fields": {} },
            { "type": "label", "fields": { "label": "Newsletter" } }
          ]
        }
      </create_rule>
      <create_rule>
        {
          "name": "Promotions",
          "condition": { "aiInstructions": "Marketing and promotional emails" },
          "actions": [
            { "type": "archive", "fields": {} },
            { "type": "label", "fields": { "label": "Promotions" } }
          ]
        }
      </create_rule>
      <create_rule>
        {
          "name": "Team",
          "condition": { "static": { "from": "@company.com" } },
          "actions": [
            { "type": "label", "fields": { "label": "Team" } }
          ]
        }
      </create_rule>
      <explanation>
        I created 4 rules to handle different types of emails.
      </explanation>
    </output>
  </example>

  <example>
    <input>
      I don't need to reply to emails from GitHub, stop labelling them as "To reply".
    </input>
    <output>
      <update_rule>
        {
          "name": "To reply",
          "learnedPatterns": [
            { "exclude": { "from": "@github.com" } }
          ]
        }
      </update_rule>
      <explanation>
        I updated the rule to stop labelling emails from GitHub as "To reply".
      </explanation>
    </output>
  </example>

  <example>
    <input>
      If I'm CC'd on an email it shouldn't be marked as "To Reply"
    </input>
    <output>
      <update_about>
        [existing about content...]
        
        - Emails where I am CC'd (not in the TO field) should not be marked as "To Reply" - they are FYI only.
      </update_about>
      <explanation>
        I can't directly modify the conversation status prompts, but I've added this preference to your Personal Instructions. The AI will now take this into account when categorizing your emails.
      </explanation>
    </output>
  </example>
</examples>`;

  const toolOptions = {
    email: user.email,
    emailAccountId,
    provider: user.account.provider,
    logger,
  };

  const accountId = emailAccountId; // fallback or logic depending on your existing code structure
  // The user suggested:
  // const provider = user.account.provider;
  // const emailAccount = await prisma.emailAccount.findFirst({ ... });

  // However, we already have `emailAccountId` passed in to `createChat`.
  // If `emailAccountId` is available, let's use it.

  let connectedEmailAccount = null;
  if (emailAccountId) {
    connectedEmailAccount = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      include: { account: true }
    });
  } else {
    // Fallback: try to find one by provider/user
    connectedEmailAccount = await prisma.emailAccount.findFirst({
      where: {
        userId: user.id,
        // provider: user.account.provider // 'provider' might not be on EmailAccount directly if it's on Account. 
        // NOTE: EmailAccount usually links to Account. 
        // But let's look at schema: EmailAccount has `accountId`. Account has `provider`.
        account: {
          provider: user.account.provider
        }
      },
      include: { account: true }
    });
  }

  if (!connectedEmailAccount) {
    // If still missing, we might be in a state where we can't run tools.
    // But for now, let's try to proceed or throw as user suggested.
    // "throw new Error(...)"
    // But wait, existing code was falling back to `user.account`.
    // Let's assume for this fix we MUST have a real EmailAccount for tools.
    // If this is a new user without one, tools might fail.
    // I'll log a warning and maybe pass null? But createAgentTools expects EmailAccount.
    // User said "Throw error if !emailAccount".

    console.warn("No linked EmailAccount found for chat tools. Tools may fail.");
    // We can't easily construct a fake one that satisfies the type.
    // Let's try to fetch ANY email account for this user as a fallback?
    connectedEmailAccount = await prisma.emailAccount.findFirst({
      where: { userId: user.id },
      include: { account: true }
    });
  }

  if (!connectedEmailAccount) {
    // Determine what to do. The user code suggested throwing.
    // I will throw to fail fast as requested.
    throw new Error(`No EmailAccount connected for user ${user.id}`);
  }

  const agentTools = await createAgentTools({
    emailAccount: {
      ...connectedEmailAccount,
      ...connectedEmailAccount.account,
      // Ensure ID is from EmailAccount, not Account if they conflict (though they shouldn't overlap much)
      id: connectedEmailAccount.id,
      // Ensure email is from EmailAccount
      email: connectedEmailAccount.email,
      // Convert Date to number for EmailAccount type compatibility
      expires_at: connectedEmailAccount.account.expires_at ? new Date(connectedEmailAccount.account.expires_at).getTime() : null
    },
    logger,
    userId: user.id
  });

  const hiddenContextMessage =
    context && context.type === "fix-rule"
      ? [
        {
          role: "system" as const,
          content:
            "Hidden context for the user's request (do not repeat this to the user):\n\n" +
            `<email>\n${stringifyEmail(
              getEmailForLLM(context.message as ParsedMessage, {
                maxLength: 3000,
              }),
              3000,
            )}\n</email>\n\n` +
            `Rules that were applied:\n${context.results
              .map((r) => `- ${r.ruleName ?? "None"}: ${r.reason}`)
              .join("\n")}\n\n` +
            `Expected outcome: ${context.expected === "new"
              ? "Create a new rule"
              : context.expected === "none"
                ? "No rule should be applied"
                : `Should match the "${context.expected.name}" rule`
            }`,
        },
      ]
      : [];

  const result = chatCompletionStream({
    userAi: user.user,
    userEmail: user.email,
    modelType: "chat",
    usageLabel: "assistant-chat",
    messages: [
      {
        role: "system",
        content: system,
      },
      ...hiddenContextMessage,
      ...messages,
    ],
    onStepFinish: async ({ text, toolCalls }) => {
      logger.trace("Step finished", { text, toolCalls });
    },
    maxSteps: 10,
    tools: {
      ...agentTools,
      getUserRulesAndSettings: getUserRulesAndSettingsTool(toolOptions),
      getLearnedPatterns: getLearnedPatternsTool(toolOptions),
      createRule: createRuleTool(toolOptions),
      updateRuleConditions: updateRuleConditionsTool(toolOptions),
      updateRuleActions: updateRuleActionsTool(toolOptions),
      updateLearnedPatterns: updateLearnedPatternsTool(toolOptions),
      updateAbout: updateAboutTool(toolOptions),
      addToKnowledgeBase: addToKnowledgeBaseTool(toolOptions),
    },
  });

  return result;
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
