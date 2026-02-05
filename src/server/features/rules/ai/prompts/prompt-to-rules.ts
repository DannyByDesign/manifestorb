import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import {
  type CreateRuleSchema,
  createRuleSchema,
} from "@/features/rules/ai/prompts/create-rule-schema";
import { createScopedLogger } from "@/server/lib/logger";
import { convertMentionsToLabels } from "@/server/lib/mention";
import { getModel } from "@/server/lib/llms/model";

const logger = createScopedLogger("ai-prompt-to-rules");

export async function aiPromptToRules({
  emailAccount,
  promptFile,
  availableGroups = [],
}: {
  emailAccount: EmailAccountWithAI;
  promptFile: string;
  availableGroups?: string[];
}): Promise<CreateRuleSchema[]> {
  const system = getSystemPrompt();

  const cleanedPromptFile = convertMentionsToLabels(promptFile);

  const prompt = `Convert the following prompt file into rules:
  
<prompt>
${cleanedPromptFile}
</prompt>

<available_groups>
${availableGroups.join("\n")}
</available_groups>`;

  const modelOptions = getModel("chat");

  const generateObject = createGenerateObject({
    emailAccount,
    label: "Prompt to rules",
    modelOptions,
  });

  try {
    const aiResponse = await generateObject({
      ...modelOptions,
      prompt,
      system,
      schema: z.object({
        rules: z.array(createRuleSchema(emailAccount.account.provider)),
      }),
    });

    if (!aiResponse.object) {
      throw new Error("No rules found in AI response");
    }

    return applyGroupHints(aiResponse.object.rules, availableGroups);
  } catch (error) {
    logger.error("Error converting prompt to rules", { error });
    throw error;
  }
}

function getSystemPrompt() {
  return `You are an AI assistant that converts email management rules into a structured format. Parse the given prompt and convert it into rules.

IMPORTANT: If the prompt contains bullet points (lines starting with "*" or "-"), treat each bullet as a separate rule.
If the prompt clearly refers to a saved group and that group is listed in <available_groups>, use condition.group with the exact group name.

Use short, concise rule names (preferably a single word). For example: 'Marketing', 'Newsletters', 'Urgent', 'Receipts'. Avoid verbose names like 'Archive and label marketing emails'.

IMPORTANT: If a user provides a snippet, use that full snippet in the rule. Don't include placeholders unless it's clear one is needed.

You can use multiple conditions in a rule, but aim for simplicity.
In most cases, you should use the "aiInstructions" and sometimes you will use other fields in addition.
If a rule can be handled fully with static conditions, do so, but this is rarely possible.

Supported actions include: ARCHIVE, LABEL, DRAFT_EMAIL, REPLY, FORWARD, SEND_EMAIL (if enabled), MARK_READ, MARK_SPAM, NOTIFY_USER, DIGEST, CALL_WEBHOOK, CREATE_TASK, CREATE_CALENDAR_EVENT, SET_TASK_PREFERENCES, and MOVE_FOLDER (Outlook).
Use only these action types. Prefer DRAFT_EMAIL for replies unless the user explicitly asks to send automatically.

IMPORTANT: You must return JSON only (no markdown or extra keys).

<examples>
  <example>
    <input>
      * Archive all newsletters and label them "Newsletter"
    </input>
    <output>
      {
        "rules": [{
          "name": "Newsletter",
          "condition": {
            "group": "Newsletters"
          },
          "actions": [
            {
              "type": "ARCHIVE"
            },
            {
              "type": "LABEL",
              "fields": {
                "label": "Newsletter"
              }
            }
          ]
        }]
      }
    </output>
  </example>

  <example>
    <input>
      * Forward urgent emails about system outages to urgent@company.com and label as "Urgent"
    </input>
    <output>
      {
        "rules": [{
          "name": "Urgent",
          "condition": {
            "aiInstructions": "Apply this rule to emails mentioning system outages or critical issues"
          },
          "actions": [
            {
              "type": "FORWARD",
              "fields": {
                "to": "urgent@company.com"
              }
            },
            {
              "type": "LABEL",
              "fields": {
                "label": "Urgent"
              }
            }
          ]
        }]
      }
    </output>
  </example>

  <example>
    <input>
      * Label all urgent emails from company.com as "Urgent"
    </input>
    <output>
      {
        "rules": [{
          "name": "Urgent",
          "condition": {
            "conditionalOperator": "AND",
            "aiInstructions": "Apply this rule to urgent emails",
            "static": {
              "from": "@company.com"
            }
          },
          "actions": [
            {
              "type": "LABEL",
              "fields": {
                "label": "Urgent"
              }
            }
          ]
        }]
      }
    </output>
  </example>

  <example>
    <input>
      * When someone asks to set up a call, reply with:
      
      """
      Hi [name],
      Thank you for your message. I'll respond within 2 hours.
      Best,
      Alice
      """
    </input>
    <output>
      {
        "rules": [{
          "name": "Call Requests",
          "condition": {
            "aiInstructions": "Apply this rule to emails from people asking to set up a call"
          },
          "actions": [
            {
              "type": "REPLY",
              "fields": {
                "content": "Hi {{name}},\nThank you for your message.\nI'll respond within 2 hours.\nBest,\nAlice"
              }
            }
          ]
        }]
      }
    </output>
  </example>
</examples>
`;
}

function applyGroupHints(
  rules: CreateRuleSchema[],
  availableGroups: string[],
): CreateRuleSchema[] {
  if (availableGroups.length === 0) return rules;
  const normalizedGroups = new Set(
    availableGroups.map((group) => group.toLowerCase()),
  );

  return rules.map((rule) => {
    const text = `${rule.name} ${rule.condition.aiInstructions ?? ""}`.toLowerCase();
    const nextRule = { ...rule };

    if (normalizedGroups.has("receipts") && text.includes("receipt")) {
      nextRule.condition = { ...rule.condition, group: "Receipts" };
      return nextRule;
    }

    if (normalizedGroups.has("newsletters") && text.includes("newsletter")) {
      nextRule.condition = { ...rule.condition, group: "Newsletters" };
      return nextRule;
    }

    return rule;
  });
}
