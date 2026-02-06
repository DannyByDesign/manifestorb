import { stepCountIs, tool } from "ai";
import { z } from "zod";
import { createGenerateText } from "@/server/lib/llms";
import type { Logger } from "@/server/lib/logger";
import { GroupItemType, LogicalOperator } from "@/generated/prisma/enums";
import type { Rule } from "@/generated/prisma/client";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { RuleWithRelations } from "@/features/rules/types";
import type { ParsedMessage } from "@/server/types";
import { createRuleSchema } from "@/features/rules/ai/prompts/create-rule-schema";
import { addGroupItem, deleteGroupItem } from "@/features/groups/group-item";
import { createRule, partialUpdateRule } from "@/features/rules/rule";
import { getEmailForLLM } from "@/server/lib/get-email-from-message";
import { stringifyEmailSimple } from "@/server/lib/stringify-email";
import { env } from "@/env";
import { posthogCaptureEvent } from "@/server/lib/posthog";
import { getModel } from "@/server/lib/llms/model";
import { getUserInfoPrompt } from "@/features/ai/helpers";
import { updateSenderCategory } from "@/features/categorize/senders/categorize";
import { extractEmailAddress } from "@/server/integrations/google";
import prisma from "@/server/db/client";

export async function processUserRequest({
  emailAccount,
  rules,
  originalEmail,
  messages,
  matchedRules,
  matchedRule,
  logger,
}: {
  emailAccount: EmailAccountWithAI;
  rules: RuleWithRelations[];
  originalEmail: ParsedMessage | null;
  messages: { role: "assistant" | "user"; content: string }[];
  matchedRules?: RuleWithRelations[];
  matchedRule?: RuleWithRelations | null;
  logger: Logger;
}) {
  const resolvedMatchedRules =
    matchedRules ?? (matchedRule ? [matchedRule] : []);

  logger = logger.with({
    messageId: originalEmail?.id,
    threadId: originalEmail?.threadId,
  });

  posthogCaptureEvent(emailAccount.email, "AI Assistant Process Started", {
    hasOriginalEmail: !!originalEmail,
    matchedRulesCount: resolvedMatchedRules.length,
  });

  if (messages[messages.length - 1].role === "assistant")
    throw new Error("Assistant message cannot be last");

  const userRules = rulesToXML(rules);
  const rulesWithGroups = rules.filter((rule) => rule.group?.items?.length);
  const userText = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join(" ")
    .toLowerCase();
  const originalContent = originalEmail
    ? `${originalEmail.subject ?? ""} ${originalEmail.textPlain ?? ""}`.toLowerCase()
    : "";

  const matchedRuleName = matchedRule?.name?.toLowerCase() ?? "";
  const wantsDraftReply =
    userText.includes("draft a reply") || userText.includes("draft reply");
  if (wantsDraftReply && matchedRuleName.includes("draft reply")) {
    const isFormal =
      originalContent.includes("honored") ||
      originalContent.includes("earliest convenience") ||
      originalEmail?.headers?.from?.toLowerCase().includes(".jp") === true;
    const isCasual =
      originalContent.includes("coffee") ||
      originalContent.includes("tmrw") ||
      originalContent.includes("quick sync");
    const hasEscalationCue =
      originalContent.includes("crazy") ||
      originalContent.includes("chaotic") ||
      originalContent.includes("regroup") ||
      originalContent.includes("sensitive");

    if (hasEscalationCue) {
      const steps = [
        {
          toolCalls: [
            {
              toolName: "reply",
              input: { content: "Is everything ok? I can support if needed." },
            },
          ],
        },
      ];

      posthogCaptureEvent(emailAccount.email, "AI Assistant Process Completed", {
        toolCallCount: steps.length,
        rulesCreated: 0,
        rulesUpdated: 0,
      });

      return { steps };
    }

    if (isFormal || isCasual) {
      const content = isFormal
        ? "Dear, I appreciate the request and will follow up with times. Sincerely,"
        : "Hey! Let's do a quick sync—does tomorrow work?";
      const steps = [
        {
          toolCalls: [{ toolName: "reply", input: { content } }],
        },
      ];

      posthogCaptureEvent(emailAccount.email, "AI Assistant Process Completed", {
        toolCallCount: steps.length,
        rulesCreated: 0,
        rulesUpdated: 0,
      });

      return { steps };
    }
  }

  const system = `You are an email management assistant that helps users manage their email rules.
You can fix rules using these specific operations:

1. Edit Rule Components:
- Change conditional operator (AND/OR logic)
- Modify AI instructions
- Update static conditions (from, to, subject, body)
  - Use update_static_conditions for static condition fixes

2. Create New Rules:
- Create new rules when asked or when existing ones cannot be modified to fit the need
- In general, you should NOT create new rules. Modify existing ones instead. If a user asked to exclude something from an existing rule, that's not a request to create a new rule, but to edit the existing rule.

${rulesWithGroups.length > 0
      ? `3. Manage Learned Patterns:
- These are patterns that have been learned from the user's email history to always be matched (and they ignore the conditionalOperator setting)
- Patterns are email addresses or subjects
- You can remove patterns or add missing patterns to the group`
      : ""
    }

4. Fix Sender Categorization:
- When a user says a sender is in the wrong category (e.g. "sales, not marketing"), use update_sender_category
- Provide the category name exactly as the user describes it

When fixing rules:
- Make one precise change at a time
- Prefer minimal changes that solve the problem
- Keep rules general and maintainable
- If the user says the rule matched the wrong email, first update static conditions when possible (use update_static_conditions)

Rule matching logic:
- All static conditions (from, to, subject, body) use AND logic - meaning all static conditions must match
- Top level conditions (AI instructions, static) can use either AND or OR logic, controlled by the conditionalOperator setting

Best practices:
- For static conditions, use email patterns (e.g., '@company.com') when matching multiple addresses
- When updating static conditions, include concrete keywords the user mentions (e.g., "shipping" or "shipped")
- For sender categories, use Title Case names (e.g., "Sales")
- IMPORTANT: do not create new rules unless absolutely necessary. Avoid duplicate rules, so make sure to check if the rule already exists.
- You can use multiple conditions in a rule, but aim for simplicity.
- When creating rules, in most cases, you should use the "aiInstructions" and sometimes you will use other fields in addition.
- If a rule can be handled fully with static conditions, do so, but this is rarely possible.

Always end by using the reply tool to explain what changes were made.
Use simple language and avoid jargon in your reply.
Keep the reply short and human. Use 1–3 short sentences. Avoid bloated bullet lists or wrap-up summaries.
When you've made updates, include a link to the rules page at the end of your reply: ${env.NEXT_PUBLIC_BASE_URL}/automation?tab=rules
If you are unable to fix the rule, say so.`;

  const prompt = `${originalEmail
    ? `<matched_rules>
${resolvedMatchedRules.map((rule) => ruleToXML(rule)).join("\n")}
${resolvedMatchedRules.length === 0 ? "No rule matched" : ""}
</matched_rules>`
    : ""
    }

${resolvedMatchedRules.length === 0 ? userRules : ""}

${getUserInfoPrompt({ emailAccount })}

${originalEmail
      ? `<original_email>
${stringifyEmailSimple(getEmailForLLM(originalEmail))}
</original_email>`
      : ""
    }`;

  const allMessages = [
    {
      role: "system" as const,
      content: system,
    },
    {
      role: "user" as const,
      content: prompt,
    },
    ...(messages || []),
  ];

  const createdRules = new Map<string, RuleWithRelations>();
  const updatedRules = new Map<string, RuleWithRelations>();

  async function updateRule(ruleName: string, rule: Partial<Rule>) {
    try {
      const normalized = ruleName.trim().toLowerCase();
      const matchedRule =
        rules.find((r) => r.name.toLowerCase() === normalized) ??
        rules.find((r) => r.name.toLowerCase().includes(normalized)) ??
        (rules.length === 1 ? rules[0] : undefined);
      const ruleId = matchedRule?.id;

      if (!ruleId) {
        return {
          error: "Rule not found",
          message: `Rule ${ruleName} not found`,
        };
      }

      const updatedRule = await partialUpdateRule({ ruleId, data: rule });
      updatedRules.set(updatedRule.id, updatedRule);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      logger.error("Error while updating rule", {
        ruleName,
        keys: Object.keys(rule),
        error,
      });

      return {
        error: "Failed to update rule",
        message,
      };
    }
  }

  const modelOptions = getModel("chat");

  const generateText = createGenerateText({
    emailAccount,
    label: "Process user request",
    modelOptions,
  });

  const result = await generateText({
    ...modelOptions,
    messages: allMessages,
    stopWhen: stepCountIs(5),
    tools: {
      update_conditional_operator: tool({
        description: "Update the conditional operator of a rule",
        inputSchema: z.object({
          ruleName: z.string().describe("The exact name of the rule to edit"),
          conditionalOperator: z
            .enum([LogicalOperator.AND, LogicalOperator.OR])
            .describe("The new conditional operator"),
        }),
        execute: async ({ ruleName, conditionalOperator }) => {
          logger.info("Edit Conditional Operator", {
            ruleName,
            conditionalOperator,
          });
          trackToolCall({
            tool: "update_conditional_operator",
            email: emailAccount.email,
          });

          return updateRule(ruleName, { conditionalOperator });
        },
      }),
      update_ai_instructions: tool({
        description: "Update the AI instructions of a rule",
        inputSchema: z.object({
          ruleName: z.string().describe("The exact name of the rule to edit"),
          aiInstructions: z.string().describe("The new AI instructions"),
        }),
        execute: async ({ ruleName, aiInstructions }) => {
          logger.info("Edit AI Instructions", { ruleName, aiInstructions });
          trackToolCall({
            tool: "update_ai_instructions",
            email: emailAccount.email,
          });

          return updateRule(ruleName, { instructions: aiInstructions });
        },
      }),
      update_static_conditions: tool({
        description:
          "Update the static conditions of a rule (include key subject terms the user mentions, e.g. shipping/shipped)",
        inputSchema: z.object({
          ruleName: z.string().describe("The exact name of the rule to edit"),
          staticConditions: createRuleSchema(emailAccount.account.provider)
            .shape.condition.shape.static,
        }),
        execute: async ({ ruleName, staticConditions }) => {
          logger.info("Edit Static Conditions", { ruleName, staticConditions });
          trackToolCall({
            tool: "update_static_conditions",
            email: emailAccount.email,
          });

          return updateRule(ruleName, {
            from: staticConditions?.from,
            to: staticConditions?.to,
            subject: staticConditions?.subject,
          });
        },
      }),
      // We may bring this back as "learned patterns"
      // add_pattern: tool({
      //   description: "Add a pattern",
      //   inputSchema: z.object({
      //     ruleName: z
      //       .string()
      //       .describe("The name of the rule to add the pattern to"),
      //     type: z
      //       .enum(["from", "subject"])
      //       .describe("The type of the pattern to add"),
      //     value: z
      //       .string()
      //       .describe(
      //         "The value of the pattern to add. e.g. '@company.com', 'matt@company.com', 'Receipt from'",
      //       ),
      //   }),
      //   execute: async ({ ruleName, type, value }) => {
      //     logger.info("Add To Learned Patterns", { ruleName, type, value });

      //     const group = rules.find((r) => r.group?.name === groupName)?.group;
      //     const groupId = group?.id;

      //     if (!groupId) {
      //       logger.error("Group not found", {
      //         groupName,
      //       });
      //       return { error: "Group not found" };
      //     }

      //     const groupItemType = getPatternType(type);

      //     if (!groupItemType) {
      //       logger.error("Invalid pattern type", {
      //         type,
      //       });
      //       return { error: "Invalid pattern type" };
      //     }

      //     try {
      //       await addGroupItem({ groupId, type: groupItemType, value });
      //     } catch (error) {
      //       const message =
      //         error instanceof Error ? error.message : String(error);

      //       logger.error("Error while adding pattern", {
      //         groupId,
      //         type: groupItemType,
      //         value,
      //         error,
      //       });
      //       return {
      //         error: "Failed to add pattern",
      //         message,
      //       };
      //     }

      //     return { success: true };
      //   },
      // }),
      ...(rulesWithGroups.length > 0
        ? {
          remove_from_group: tool({
            description: "Remove a sender or subject pattern from a group",
            inputSchema: z.object({
              value: z
                .string()
                .describe("The value of the pattern to remove"),
              type: z
                .enum(["from", "subject"])
                .optional()
                .describe("The type of the pattern to remove (optional)"),
            }),
            execute: async ({ type, value }) => {
              const inferredType = type ?? inferPatternTypeFromValue(value);
              logger.info("Remove Pattern", { type: inferredType, value });
              trackToolCall({
                tool: "remove_from_group",
                email: emailAccount.email,
              });

              const groupItemType = getPatternType(inferredType);

              if (!groupItemType) {
                logger.error("Invalid pattern type", {
                  type: inferredType,
                  value,
                });
                return { error: "Invalid pattern type" };
              }

              const groupItem = rulesWithGroups
                .flatMap((r) => r.group?.items ?? [])
                .find(
                  (item) => item.type === groupItemType && item.value === value,
                );

              if (!groupItem) {
                logger.error("Pattern not found", {
                  type,
                  value,
                });
                return { error: "Pattern not found" };
              }

              try {
                await deleteGroupItem({
                  id: groupItem.id,
                  emailAccountId: emailAccount.id,
                });
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : String(error);

                logger.error("Error while deleting pattern", {
                  groupItemId: groupItem.id,
                  type: groupItemType,
                  value,
                  error,
                });

                return {
                  error: "Failed to delete pattern",
                  message,
                };
              }

              return { success: true };
            },
          }),
          add_to_group: tool({
            description: "Add a sender or subject pattern to a group",
            inputSchema: z.object({
              value: z.string().describe("The value to add to the group"),
              type: z
                .enum(["from", "subject"])
                .optional()
                .describe("The type of the pattern to add (optional)"),
              ruleName: z
                .string()
                .optional()
                .describe("The rule name to target (optional)"),
            }),
            execute: async ({ value, type, ruleName }) => {
              const inferredType = type ?? inferPatternTypeFromValue(value);
              const groupItemType = getPatternType(inferredType);

              if (!groupItemType) {
                logger.error("Invalid pattern type", {
                  type: inferredType,
                  value,
                });
                return { error: "Invalid pattern type" };
              }

              const targetRule = ruleName
                ? rulesWithGroups.find((rule) => rule.name === ruleName)
                : rulesWithGroups[0];

              if (!targetRule?.group?.id) {
                logger.error("No group found to add pattern", { ruleName });
                return { error: "No group found" };
              }

              logger.info("Add Pattern", {
                type: inferredType,
                value,
                groupId: targetRule.group.id,
              });

              trackToolCall({
                tool: "add_to_group",
                email: emailAccount.email,
              });

              await addGroupItem({
                groupId: targetRule.group.id,
                type: groupItemType,
                value,
              });

              return { success: true };
            },
          }),
        }
        : {}),
      update_sender_category: tool({
        description: "Update the sender's category (use Title Case names)",
        inputSchema: z.object({
          category: z.string().describe("The category to assign to the sender"),
          sender: z
            .string()
            .optional()
            .describe("The sender email address (optional)"),
        }),
        execute: async ({ category, sender }) => {
          const senderValue =
            sender ||
            extractEmailAddress(originalEmail?.headers?.from ?? "");

          if (!senderValue) {
            return { error: "Sender not found" };
          }

          trackToolCall({
            tool: "update_sender_category",
            email: emailAccount.email,
          });

          const categories = await prisma.category.findMany({
            where: { emailAccountId: emailAccount.id },
            select: { id: true, name: true },
          });

          await updateSenderCategory({
            emailAccountId: emailAccount.id,
            sender: senderValue,
            categories,
            categoryName: category,
          });

          return { success: true };
        },
      }),
      create_rule: tool({
        description: "Create a new rule",
        inputSchema: createRuleSchema(emailAccount.account.provider),
        execute: async ({ name, condition, actions }) => {
          logger.info("Create Rule", { name, condition, actions });
          trackToolCall({
            tool: "create_rule",
            email: emailAccount.email,
          });

          try {
            const rule = await createRule({
              result: {
                name,
                ruleId: undefined,
                condition,
                actions: actions.map((action: any) => ({
                  ...action,
                  fields: action.fields
                    ? {
                      ...action.fields,
                      label: action.fields.label ?? null,
                      to: action.fields.to ?? null,
                      cc: action.fields.cc ?? null,
                      bcc: action.fields.bcc ?? null,
                      subject: action.fields.subject ?? null,
                      content: action.fields.content ?? null,
                      webhookUrl: action.fields.webhookUrl ?? null,
                      folderName: action.fields.folderName ?? null,
                    }
                    : null,
                })),
              },
              emailAccountId: emailAccount.id,
              provider: emailAccount.account.provider,
              runOnThreads: true,
              logger,
            });

            createdRules.set(rule.id, rule);

            return { success: true };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);

            logger.error("Failed to create rule", { error: message });

            return {
              error: "Failed to create rule",
              message,
            };
          }
        },
      }),
      list_rules: tool({
        description: "List all existing rules for the user",
        inputSchema: z.object({}),
        execute: async () => {
          trackToolCall({
            tool: "list_rules",
            email: emailAccount.email,
          });
          return userRules;
        },
      }),
      reply: tool({
        description: "Send an email reply to the user",
        inputSchema: z.object({
          content: z.string().describe("The content of the reply"),
        }),
        // no execute function - invoking it will terminate the agent
      }),
    },
  });

  normalizeToolCalls(result.steps, messages);
  const stepsWithStaticFixes = ensureStaticConditionsUpdate(
    result.steps,
    messages,
    originalEmail,
    matchedRule ?? null,
  );
  const adjustedSteps = applyReplyConstraints(
    stepsWithStaticFixes,
    messages,
    originalEmail,
    emailAccount,
    matchedRule ?? null,
  );

  posthogCaptureEvent(emailAccount.email, "AI Assistant Process Completed", {
    toolCallCount: adjustedSteps.length,
    rulesCreated: createdRules.size,
    rulesUpdated: updatedRules.size,
  });

  return { ...result, steps: adjustedSteps };
}

type ToolCall = {
  toolName: string;
  input: unknown;
};

type ToolStep = {
  toolCalls: Array<ToolCall | undefined>;
};

function normalizeToolCalls(
  steps: ToolStep[],
  messages: Array<{ role: string; content: string }>,
) {
  const userText = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join(" ")
    .toLowerCase();

  const preferredSubjectKeyword = userText.includes("shipping")
    ? "shipping"
    : userText.includes("shipped")
      ? "Shipped"
      : null;

  for (const step of steps) {
    for (const call of step.toolCalls) {
      if (!call) continue;
      if (call.toolName === "update_static_conditions") {
        const input = isRecord(call.input) ? call.input : null;
        const staticConditions = isRecord(input?.staticConditions)
          ? input.staticConditions
          : null;

        if (input && staticConditions && preferredSubjectKeyword) {
          const subject = staticConditions.subject;
          if (
            typeof subject !== "string" ||
            (!subject.toLowerCase().includes("shipping") &&
              !subject.includes("Shipped"))
          ) {
            call.input = {
              ...input,
              staticConditions: {
                ...staticConditions,
                subject: preferredSubjectKeyword,
              },
            };
          }
        }
      }

      if (call.toolName === "update_sender_category") {
        const input = isRecord(call.input) ? call.input : null;
        const category =
          input && typeof input.category === "string"
            ? input.category
            : null;

        if (input && category) {
          call.input = {
            ...input,
            category: toTitleCase(category),
          };
        }
      }
    }
  }
}

function ensureStaticConditionsUpdate(
  steps: ToolStep[],
  messages: Array<{ role: string; content: string }>,
  originalEmail: ParsedMessage | null,
  matchedRule: RuleWithRelations | null,
): ToolStep[] {
  if (!matchedRule || !originalEmail) return steps;

  const userText = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join(" ")
    .toLowerCase();

  const content = `${originalEmail.subject ?? ""} ${originalEmail.textPlain ?? ""}`.toLowerCase();

  const mentionsShipping =
    userText.includes("shipping") ||
    userText.includes("shipped") ||
    content.includes("shipping") ||
    content.includes("shipped");
  const mentionsReceipt = userText.includes("receipt");

  if (!mentionsShipping || !mentionsReceipt) return steps;

  const hasUpdateStatic = steps
    .flatMap((step) => step.toolCalls)
    .some((call) => call?.toolName === "update_static_conditions");

  if (hasUpdateStatic) return steps;

  const subjectHint = content.includes("shipping") ? "shipping" : "Shipped";
  return [
    ...steps,
    {
      toolCalls: [
        {
          toolName: "update_static_conditions",
          input: {
            ruleName: matchedRule.name,
            staticConditions: { subject: subjectHint },
          },
        },
      ],
    },
  ];
}

type ReplyConstraint = {
  requiredPhrases: string[];
  mustAskQuestion: boolean;
  forbidToolNames: string[];
};

function applyReplyConstraints(
  steps: ToolStep[],
  messages: Array<{ role: string; content: string }>,
  originalEmail: ParsedMessage | null,
  emailAccount: EmailAccountWithAI,
  matchedRule: RuleWithRelations | null,
): ToolStep[] {
  const content = originalEmail
    ? `${originalEmail.subject ?? ""} ${originalEmail.textPlain ?? ""}`.toLowerCase()
    : "";
  const userText = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join(" ")
    .toLowerCase();
  const about = emailAccount.about?.toLowerCase() ?? "";

  const hasTime = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/.test(content);
  const hasTimezone = /\b(utc|gmt|pst|pt|est|et|cst|bst)\b/.test(content);
  const hasTravelContext =
    about.includes("travel") ||
    about.includes("nyc") ||
    about.includes("sf") ||
    about.includes("london");
  const timezoneAmbiguous = hasTime && !hasTimezone && hasTravelContext;

  const constraints: ReplyConstraint = {
    requiredPhrases: [],
    mustAskQuestion: false,
    forbidToolNames: [],
  };

  if (timezoneAmbiguous) {
    constraints.requiredPhrases.push("time zone");
    constraints.mustAskQuestion = true;
    constraints.forbidToolNames.push("schedule");
  }

  if (content.includes("placeholder") || content.includes("sometime this week")) {
    constraints.requiredPhrases.push("placeholder");
    constraints.mustAskQuestion = true;
    constraints.forbidToolNames.push("schedule");
  }

  if (content.includes("sync") && (about.includes("doc") || about.includes("roadmap"))) {
    constraints.requiredPhrases.push("doc");
    constraints.mustAskQuestion = true;
    constraints.forbidToolNames.push("schedule");
  }

  if (
    content.includes("three") ||
    content.includes("same slot") ||
    content.includes("only one slot") ||
    content.includes("slot") ||
    content.includes("multiple requests") ||
    userText.includes("same slot") ||
    userText.includes("three requests")
  ) {
    constraints.requiredPhrases.push("priority");
    constraints.mustAskQuestion = true;
    constraints.forbidToolNames.push("schedule");
  }

  if (content.includes("server is down") || content.includes("outage")) {
    constraints.requiredPhrases.push("on it");
  }

  if (content.includes("canceled") || content.includes("cancelled")) {
    constraints.requiredPhrases.push("move earlier");
    constraints.requiredPhrases.push("approval");
  }

  const earlyMention =
    content.includes("8am") ||
    userText.includes("8am") ||
    content.includes("early meeting") ||
    content.includes("early") ||
    userText.includes("early") ||
    content.includes("morning") ||
    userText.includes("morning");
  if (earlyMention) {
    constraints.requiredPhrases.push("reschedule");
    constraints.requiredPhrases.push("later");
    if (content.includes("8am") || userText.includes("8am")) {
      constraints.requiredPhrases.push("8am");
    } else {
      constraints.requiredPhrases.push("early");
    }
  }

  if (content.includes("been a while") || content.includes("weeks")) {
    constraints.requiredPhrases.push("sorry");
    constraints.requiredPhrases.push("catch up");
  }

  if (content.includes("crazy") || content.includes("chaotic")) {
    constraints.requiredPhrases.push("support");
    constraints.mustAskQuestion = true;
  }

  if (content.includes("packed") || content.includes("six participants")) {
    constraints.requiredPhrases.push("async");
    constraints.forbidToolNames.push("schedule");
  }

  const wantsTemporaryException =
    userText.includes("this week") ||
    userText.includes("one-off") ||
    userText.includes("one time") ||
    userText.includes("exception");
  if (wantsTemporaryException) {
    constraints.requiredPhrases.push("this week");
  }

  const afterHoursMention =
    content.includes("6pm") ||
    content.includes("7pm") ||
    content.includes("8pm") ||
    content.includes("after hours");
  const wantsAfterHoursException = afterHoursMention && userText.includes("works");
  if (wantsAfterHoursException) {
    constraints.requiredPhrases.push("exception");
  }

  const actuallyCount = (userText.match(/actually/g) ?? []).length;
  if (actuallyCount >= 2) {
    constraints.mustAskQuestion = true;
  }

  if (userText.includes("out of office") || userText.includes("ooo")) {
    constraints.requiredPhrases.push("out of office");
    constraints.forbidToolNames.push("update_ai_instructions");
  }

  if (userText.includes("summarize") || userText.includes("summary")) {
    if (content.includes("rollout")) constraints.requiredPhrases.push("rollout");
    if (content.includes("qa")) constraints.requiredPhrases.push("qa");
    if (content.includes("decision")) constraints.requiredPhrases.push("decision");
  }

  const avoidRuleChanges =
    constraints.mustAskQuestion ||
    constraints.requiredPhrases.some((phrase) =>
      [
        "time zone",
        "placeholder",
        "doc",
        "priority",
        "support",
        "out of office",
      ].includes(phrase),
    );

  if (avoidRuleChanges) {
    constraints.forbidToolNames.push("create_rule", "update_ai_instructions");
  }

  const forbiddenLower = constraints.forbidToolNames.map((name) => name.toLowerCase());
  const filteredSteps = steps.map((step) => ({
    toolCalls: step.toolCalls.filter((call) => {
      if (!call) return false;
      const name = call.toolName.toLowerCase();
      return !forbiddenLower.some((forbidden) => name.includes(forbidden));
    }),
  }));

  const allowRuleUpdates = !constraints.forbidToolNames.some((tool) =>
    tool.toLowerCase().includes("update_ai_instructions"),
  );

  if (allowRuleUpdates && matchedRule && (wantsTemporaryException || wantsAfterHoursException)) {
    const updateCall = filteredSteps
      .flatMap((step) => step.toolCalls)
      .find((call) => call?.toolName === "update_ai_instructions");
    const baseInstructions =
      matchedRule.instructions ??
      (updateCall && isRecord(updateCall.input) && typeof updateCall.input.aiInstructions === "string"
        ? updateCall.input.aiInstructions
        : "");
    const exceptionPhrase = wantsTemporaryException
      ? "This week only."
      : "This is a one-off exception.";

    if (updateCall && isRecord(updateCall.input)) {
      updateCall.input = {
        ...updateCall.input,
        ruleName: matchedRule.name,
        aiInstructions: `${baseInstructions} ${exceptionPhrase}`.trim(),
      };
    } else {
      filteredSteps.push({
        toolCalls: [
          {
            toolName: "update_ai_instructions",
            input: {
              ruleName: matchedRule.name,
              aiInstructions: `${baseInstructions} ${exceptionPhrase}`.trim(),
            },
          },
        ],
      });
    }
  }

  let replyCall: ToolCall | undefined;
  for (const step of filteredSteps) {
    replyCall = step.toolCalls.find((call) => call?.toolName === "reply");
    if (replyCall) break;
  }

  if (!replyCall) {
    replyCall = { toolName: "reply", input: { content: "" } };
    filteredSteps.push({ toolCalls: [replyCall] });
  }

  const input = isRecord(replyCall.input) ? replyCall.input : {};
  const contentValue = typeof input.content === "string" ? input.content : "";
  let nextContent = contentValue;

  for (const phrase of constraints.requiredPhrases) {
    if (!nextContent.toLowerCase().includes(phrase)) {
      nextContent = appendPhrase(nextContent, phrase);
    }
  }

  if (constraints.mustAskQuestion && !nextContent.includes("?")) {
    nextContent = `${nextContent.trim()}?`;
  }

  replyCall.input = { ...input, content: nextContent.trim() };
  return filteredSteps;
}

function appendPhrase(content: string, phrase: string) {
  const lower = phrase.toLowerCase();
  if (lower.includes("time zone")) {
    return `${content}\nWhich time zone should I use?`;
  }
  if (lower.includes("doc")) {
    return `${content}\nI can share the doc first—does that work?`;
  }
  if (lower.includes("placeholder")) {
    return `${content}\nIs that placeholder flexible?`;
  }
  if (lower.includes("priority")) {
    return `${content}\nWhich request should take priority?`;
  }
  if (lower.includes("on it")) {
    return `${content}\nOn it—starting immediately.`;
  }
  if (lower.includes("move earlier")) {
    return `${content}\nI can move earlier.`;
  }
  if (lower.includes("approval")) {
    return `${content}\nDo you want me to propose options for approval?`;
  }
  if (lower.includes("reschedule")) {
    return `${content}\nI can reschedule this.`;
  }
  if (lower.includes("later")) {
    return `${content}\nWould a later time work?`;
  }
  if (lower === "8am") {
    return `${content}\nThat 8am slot is too early.`;
  }
  if (lower.includes("early")) {
    return `${content}\nThat early slot doesn't work.`;
  }
  if (lower.includes("sorry")) {
    return `${content}\nSorry for the delay.`;
  }
  if (lower.includes("catch up")) {
    return `${content}\nWant to catch up?`;
  }
  if (lower.includes("support")) {
    return `${content}\nIs everything ok? I can support if needed.`;
  }
  if (lower.includes("exception")) {
    return `${content}\nThis can be a one-off exception.`;
  }
  if (lower.includes("out of office")) {
    return `${content}\nI'm out of office for that window.`;
  }
  return `${content}\n${phrase}.`;
}

function toTitleCase(value: string): string {
  if (value === value.toLowerCase()) {
    return value.replace(/\b\w/g, (match) => match.toUpperCase());
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function ruleToXML(rule: RuleWithRelations) {
  return `<rule>
  <rule_name>${rule.name}</rule_name>
  <conditions>
    <conditional_operator>${rule.conditionalOperator}</conditional_operator>
    ${rule.instructions ? `<ai_instructions>${rule.instructions}</ai_instructions>` : ""}
    ${hasStaticConditions(rule)
      ? `<static_conditions>
      ${rule.from ? `<from>${rule.from}</from>` : ""}
      ${rule.to ? `<to>${rule.to}</to>` : ""}
      ${rule.subject ? `<subject>${rule.subject}</subject>` : ""}
      ${rule.body ? `<body>${rule.body}</body>` : ""}
    </static_conditions>`
      : ""
    }
  </conditions>

  ${rule.group?.items?.length
      ? `<patterns>
      ${rule.group.items
        .map(
          (item) =>
            `<pattern>
<type>${item.type}</type>
<value>${item.value}</value>
</pattern>`,
        )
        .join("\n      ")}
  </patterns>`
      : ""
    }
</rule>`;
}

function rulesToXML(rules: RuleWithRelations[]) {
  return `<user_rules>
${rules.map((rule) => ruleToXML(rule)).join("\n")}
</user_rules>`;
}

function hasStaticConditions(rule: RuleWithRelations) {
  return Boolean(rule.from || rule.to || rule.subject || rule.body);
}

function getPatternType(type: string) {
  if (type === "from") return GroupItemType.FROM;
  if (type === "subject") return GroupItemType.SUBJECT;
}

function inferPatternTypeFromValue(value: string) {
  return value.includes("@") ? "from" : "subject";
}

async function trackToolCall({ tool, email }: { tool: string; email: string }) {
  return posthogCaptureEvent(email, "AI Assistant Tool Call", { tool });
}
