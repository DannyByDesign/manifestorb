import { z } from "zod";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { Action, Rule } from "@/generated/prisma/client";
import { getModel } from "@/server/lib/llms/model";
import { createGenerateObject } from "@/server/lib/llms";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("ai/find-existing-rules");

export async function aiFindExistingRules({
  emailAccount,
  promptRulesToEdit,
  promptRulesToRemove,
  databaseRules,
}: {
  emailAccount: EmailAccountWithAI;
  promptRulesToEdit: { oldRule: string; newRule: string }[];
  promptRulesToRemove: string[];
  databaseRules: (Rule & { actions: Action[] })[];
}) {
  const promptRules = [
    ...promptRulesToEdit.map((r) => r.oldRule),
    ...promptRulesToRemove,
  ];

  const system =
    "You are an AI assistant that checks if the prompt rules are already in the database.";
  const prompt = `Analyze the following prompt rules and the existing database rules to identify the existing rules that match the prompt rules:

## Prompt rules:
${promptRules.map((rule, index) => `${index + 1}: ${rule}`).join("\n")}

## Existing database rules:
${JSON.stringify(databaseRules, null, 2)}

Please return the existing rules that match the prompt rules in JSON format (JSON only, no markdown).
Use "promptNumber" as the 1-based index from the prompt rules list. Return an empty array if none match.

<example>
{
  "existingRules": [
    {
      "ruleId": "123",
      "promptNumber": 1
    }
  ]
}
</example>
`;

  const modelOptions = getModel("chat");

  const generateObject = createGenerateObject({
    emailAccount,
    label: "Find existing rules",
    modelOptions,
  });

  try {
    const result = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema: z.object({
        existingRules: z
          .array(
            z.object({
              ruleId: z.string().describe("The id of the existing rule"),
              promptNumber: z
                .number()
                .describe("The index of the prompt that matches the rule"),
            }),
          )
          .describe("The existing rules that match the prompt rules"),
      }),
    });

    if (!result.object) {
      logger.error("No object found in AI response", { result });
      return {
        editedRules: [],
        removedRules: [],
      };
    }

    const existingRules = result.object.existingRules.map((rule: { ruleId: string; promptNumber: number }) => {
      const promptRule = rule.promptNumber
        ? promptRules[rule.promptNumber - 1]
        : null;

      const toRemove = promptRule
        ? promptRulesToRemove.includes(promptRule)
        : null;

      const toEdit = promptRule
        ? promptRulesToEdit.find((r) => r.oldRule === promptRule)
        : null;

      return {
        rule: databaseRules.find((dbRule) => dbRule.id === rule.ruleId),
        promptNumber: rule.promptNumber,
        promptRule,
        toRemove: !!toRemove,
        toEdit: !!toEdit,
        updatedPromptRule: toEdit?.newRule,
      };
    });

    return {
      editedRules: existingRules.filter((rule: any) => rule.toEdit),
      removedRules: existingRules.filter((rule: any) => rule.toRemove),
    };
  } catch (error) {
    logger.error("Error finding existing rules", { error });
    return {
      editedRules: [],
      removedRules: [],
    };
  }
}
