import z from "zod";
import { createPatch } from "diff";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import { getModel } from "@/server/lib/llms/model";
import { createGenerateObject } from "@/server/lib/llms";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("ai/diff-rules");

export async function aiDiffRules({
  emailAccount,
  oldPromptFile,
  newPromptFile,
}: {
  emailAccount: EmailAccountWithAI;
  oldPromptFile: string;
  newPromptFile: string;
}) {
  const diff = createPatch("prompt", oldPromptFile, newPromptFile);

  const system =
    "You are an AI assistant that analyzes differences between two prompt files and identifies added, edited, and removed rules.";
  const prompt = `Analyze the following prompt files and their diff to identify the added, edited, and removed rules:

## Old prompt file:
${oldPromptFile}

## New prompt file:
${newPromptFile}

## Diff for guidance only:
${diff}

Please identify and return the rules that were added, edited, or removed, following these guidelines:
1. Return the full content of each rule, not just the changes.
2. For edited rules, include the new version in the 'editedRules' category ONLY.
3. Do NOT include edited rules in the 'addedRules' or 'removedRules' categories.
4. Treat any change to a rule, no matter how small, as an edit.
5. Ignore changes in whitespace or formatting unless they alter the rule's meaning.
6. If a rule is moved without other changes, do not categorize it as edited.
7. Preserve the exact formatting of rules, including leading bullet markers like "* ".

Organize your response using the 'diff_rules' function.

IMPORTANT: Do not include a rule in more than one category. If a rule is edited, do not include it in the 'removedRules' category!
If a rule is edited, it is an edit and not a removal! Be extra careful to not make this mistake.

Return the result in JSON format (JSON only, no markdown or extra keys).

<example>
{
  "addedRules": ["* rule text1", "* rule text2"],
  "editedRules": [
    {
      "oldRule": "* rule text3",
      "newRule": "* rule text4 updated"
    },
  ],
  "removedRules": ["* rule text5", "* rule text6"]
}
</example>
`;

  const modelOptions = getModel("chat");

  const generateObject = createGenerateObject({
    emailAccount,
    label: "Diff rules",
    modelOptions,
  });

  try {
    const result = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schemaName: "diff_rules",
      schemaDescription:
        "The result of the diff rules analysis. Return the result in JSON format. Do not include any other text in your response.",
      schema: z.object({
        addedRules: z.array(z.string()).describe("The added rules"),
        editedRules: z
          .array(
            z.object({
              oldRule: z.string().describe("The old rule"),
              newRule: z.string().describe("The new rule"),
            }),
          )
          .describe("The edited rules"),
        removedRules: z.array(z.string()).describe("The removed rules"),
      }),
    });

    if (!result.object) {
      throw new Error("Missing diff rules result");
    }

    const normalized = normalizeBullets(
      result.object,
      oldPromptFile,
      newPromptFile,
    );

    return restoreRulesFromSources(normalized, oldPromptFile, newPromptFile);
  } catch (error) {
    logger.error("Error diffing rules", { error });
    throw error;
  }
}

function normalizeBullets(
  result: {
    addedRules: string[];
    editedRules: { oldRule: string; newRule: string }[];
    removedRules: string[];
  },
  oldPromptFile: string,
  newPromptFile: string,
) {
  const bulletPrefix = detectBulletPrefix(`${oldPromptFile}\n${newPromptFile}`);
  if (!bulletPrefix) return result;

  const withPrefix = (value: string) =>
    value.trim().startsWith(bulletPrefix)
      ? value.trim()
      : `${bulletPrefix}${value.trim()}`;

  return {
    addedRules: result.addedRules.map(withPrefix),
    editedRules: result.editedRules.map((rule) => ({
      oldRule: withPrefix(rule.oldRule),
      newRule: withPrefix(rule.newRule),
    })),
    removedRules: result.removedRules.map(withPrefix),
  };
}

function restoreRulesFromSources(
  result: {
    addedRules: string[];
    editedRules: { oldRule: string; newRule: string }[];
    removedRules: string[];
  },
  oldPromptFile: string,
  newPromptFile: string,
) {
  const oldRules = extractRuleLines(oldPromptFile);
  const newRules = extractRuleLines(newPromptFile);

  return {
    addedRules: result.addedRules.map((rule) =>
      restoreRuleFromSource(rule, newRules),
    ),
    editedRules: result.editedRules.map((rule) => ({
      oldRule: restoreRuleFromSource(rule.oldRule, oldRules),
      newRule: restoreRuleFromSource(rule.newRule, newRules),
    })),
    removedRules: result.removedRules.map((rule) =>
      restoreRuleFromSource(rule, oldRules),
    ),
  };
}

function extractRuleLines(promptText: string): string[] {
  return promptText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("* ") || line.startsWith("- "));
}

function restoreRuleFromSource(rule: string, sourceRules: string[]): string {
  const trimmed = rule.trim();
  const exact = sourceRules.find((line) => line.trim() === trimmed);
  if (exact) return exact.trim();

  const prefixMatch = sourceRules.find((line) =>
    line.trim().startsWith(trimmed),
  );
  if (prefixMatch) return prefixMatch.trim();

  return trimmed;
}

function detectBulletPrefix(promptText: string): string | null {
  const lines = promptText.split("\n").map((line) => line.trim());
  if (lines.some((line) => line.startsWith("* "))) return "* ";
  if (lines.some((line) => line.startsWith("- "))) return "- ";
  return null;
}
