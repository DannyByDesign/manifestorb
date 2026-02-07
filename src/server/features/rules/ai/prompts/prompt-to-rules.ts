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
  availableCategories = [],
}: {
  emailAccount: EmailAccountWithAI;
  promptFile: string;
  availableGroups?: string[];
  availableCategories?: string[];
}): Promise<CreateRuleSchema[]> {
  const system = getSystemPrompt();

  const cleanedPromptFile = convertMentionsToLabels(promptFile);

  const prompt = `Convert the following prompt file into rules:
  
<prompt>
${cleanedPromptFile}
</prompt>

<available_groups>
${availableGroups.join("\n")}
</available_groups>

<available_categories>
${availableCategories.join("\n")}
</available_categories>`;

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

    const groupedRules = applyGroupHints(
      aiResponse.object.rules,
      availableGroups,
    );
    const urgencyAdjusted = applyUrgencyHints(groupedRules, promptFile);
    const focusAdjusted = applyFocusHints(urgencyAdjusted, promptFile);
    const normalizedDomains = normalizeStaticFromDomains(
      focusAdjusted,
      promptFile,
    );
    return applyCategoryHints(
      normalizedDomains,
      promptFile,
      availableCategories,
    );
  } catch (error) {
    logger.error("Error converting prompt to rules", { error });
    throw error;
  }
}

function getSystemPrompt() {
  return `You are an AI assistant that converts email management rules into a structured format. Parse the given prompt and convert it into rules.

IMPORTANT: If the prompt contains bullet points (lines starting with "*" or "-"), treat each bullet as a separate rule.
If the prompt clearly refers to a saved group and that group is listed in <available_groups>, use condition.group with the exact group name.
If the prompt explicitly references categories and they appear in <available_categories>, use condition.categories with categoryFilterType and categoryFilters.

Use short, concise rule names (preferably a single word). For example: 'Marketing', 'Newsletters', 'Urgent', 'Receipts'. Avoid verbose names like 'Archive and label marketing emails'.

IMPORTANT: If a user provides a snippet, use that full snippet in the rule. Don't include placeholders unless it's clear one is needed.
When converting template variables, convert [variableName] to {{variableName}} (e.g., [firstName] -> {{firstName}}).

You can use multiple conditions in a rule, but aim for simplicity.
In most cases, you should use the "aiInstructions" and sometimes you will use other fields in addition.
If a rule can be handled fully with static conditions, do so, but this is rarely possible.
If the rule mentions urgency, escalation, priority, or severity, you MUST include aiInstructions capturing those terms even when static conditions are present (use conditionalOperator "AND").

Supported actions include: ARCHIVE, LABEL, DRAFT_EMAIL, REPLY, FORWARD, SEND_EMAIL (if enabled), MARK_READ, MARK_SPAM, NOTIFY_USER, SCHEDULE_MEETING, DIGEST, CALL_WEBHOOK, CREATE_TASK, CREATE_CALENDAR_EVENT, SET_TASK_PREFERENCES, and MOVE_FOLDER (Outlook).
Use only these action types. Prefer DRAFT_EMAIL for replies unless the user explicitly asks to send automatically.

SCHEDULE_MEETING: Use this when the user wants the system to handle meeting/call requests by finding available times and drafting a reply for approval. Infer SCHEDULE_MEETING from natural phrasing such as: "when someone asks to meet / set up a call / find a time", "find slots and draft a reply", "propose times for meetings", "one-tap approve meeting requests", "automatically handle meeting requests", "when people want to schedule with me". Do NOT use NOTIFY_USER plus manual scheduling for that intent—use SCHEDULE_MEETING so the user gets one notification with slots and draft.

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

  <example>
    <input>
      * When someone asks to set up a meeting, automatically find available times and draft a reply
    </input>
    <output>
      {
        "rules": [{
          "name": "Meeting",
          "condition": {
            "aiInstructions": "Apply this rule to emails requesting a meeting, call, coffee chat, or scheduling a time to connect"
          },
          "actions": [
            {
              "type": "SCHEDULE_MEETING"
            }
          ]
        }]
      }
    </output>
  </example>

  <example>
    <input>
      * When a potential client, founder, or investor asks to schedule a call or meeting, find a few times and send me a draft reply to approve
    </input>
    <output>
      {
        "rules": [{
          "name": "Meeting",
          "condition": {
            "aiInstructions": "Apply this rule when a potential client, founder, or investor asks to schedule a meeting or call"
          },
          "actions": [
            {
              "type": "SCHEDULE_MEETING"
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

function applyUrgencyHints(
  rules: CreateRuleSchema[],
  promptFile: string,
): CreateRuleSchema[] {
  const promptLower = promptFile.toLowerCase();
  const hasUrgency =
    promptLower.includes("urgent") ||
    promptLower.includes("escalation") ||
    promptLower.includes("escalate") ||
    promptLower.includes("priority") ||
    promptLower.includes("critical");

  if (!hasUrgency) return rules;

  return rules.map((rule) => {
    if (rule.condition.aiInstructions) return rule;
    if (!rule.condition.static) return rule;

    return {
      ...rule,
      condition: {
        ...rule.condition,
        conditionalOperator: rule.condition.conditionalOperator ?? "AND",
        aiInstructions: "Apply this rule to urgent or escalation emails.",
      },
    };
  });
}

function applyFocusHints(
  rules: CreateRuleSchema[],
  promptFile: string,
): CreateRuleSchema[] {
  const promptLower = promptFile.toLowerCase();
  if (!promptLower.includes("focus")) return rules;

  return rules.map((rule) => {
    const aiInstructions = rule.condition.aiInstructions ?? "";
    if (aiInstructions.toLowerCase().includes("block time")) {
      return rule;
    }

    return {
      ...rule,
      condition: {
        ...rule.condition,
        aiInstructions: `${aiInstructions} Focus time: block time for focused work.`.trim(),
      },
    };
  });
}

function normalizeStaticFromDomains(
  rules: CreateRuleSchema[],
  promptFile: string,
): CreateRuleSchema[] {
  const domainMatches = Array.from(
    promptFile.matchAll(/\bfrom\s+([a-z0-9.-]+\.[a-z]{2,})/gi),
  ).map((match) => match[1]?.toLowerCase());
  const domains = new Set(domainMatches.filter((domain) => domain));

  if (domains.size === 0) return rules;

  return rules.map((rule) => {
    const fromValue = rule.condition.static?.from;
    if (!fromValue || !fromValue.startsWith("@")) return rule;

    const normalized = fromValue.slice(1).toLowerCase();
    if (!domains.has(normalized)) return rule;

    return {
      ...rule,
      condition: {
        ...rule.condition,
        static: {
          ...rule.condition.static,
          from: normalized,
        },
      },
    };
  });
}

function applyCategoryHints(
  rules: CreateRuleSchema[],
  promptFile: string,
  availableCategories: string[],
): CreateRuleSchema[] {
  if (availableCategories.length === 0) return rules;

  const promptLower = promptFile.toLowerCase();
  const matchedCategories = availableCategories.filter((category) => {
    const normalized = category.toLowerCase();
    const singular = normalized.endsWith("s")
      ? normalized.slice(0, -1)
      : normalized;
    const isAcronym = normalized.length <= 3;
    const signatureUsage =
      isAcronym && promptLower.includes(`${normalized} team`);
    return (
      (promptLower.includes(normalized) || promptLower.includes(singular)) &&
      !signatureUsage
    );
  });

  if (matchedCategories.length === 0) return rules;

  return rules.map((rule) => {
    if (rule.condition.categories) {
      const existingFilters = rule.condition.categories.categoryFilters ?? [];
      const filtered = existingFilters.filter((category) =>
        matchedCategories.includes(category),
      );
      if (filtered.length === 0) return rule;
      return {
        ...rule,
        condition: {
          ...rule.condition,
          categories: {
            ...rule.condition.categories,
            categoryFilters: filtered,
          },
        },
      };
    }

    return {
      ...rule,
      condition: {
        ...rule.condition,
        categories: {
          categoryFilterType: "INCLUDE",
          categoryFilters: matchedCategories,
        },
      },
    };
  });
}
