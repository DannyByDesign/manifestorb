import { describe, expect, test, vi } from "vitest";
import { aiPromptToRules } from "@/features/rules/ai/prompts/prompt-to-rules";
import { getEmailAccount } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: vague instruction focus", () => {
  test(
    "creates a minimal focus rule without assumptions",
    async () => {
      const result = await aiPromptToRules({
        emailAccount: getEmailAccount(),
        promptFile: "I need more focus time.",
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].condition.aiInstructions?.toLowerCase()).toContain("focus");
      expect(result[0].condition.static).toBeFalsy();
    },
    TIMEOUT,
  );
});
