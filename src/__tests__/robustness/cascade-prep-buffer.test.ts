import { describe, expect, test, vi } from "vitest";
import { aiPromptToRules } from "@/features/rules/ai/prompts/prompt-to-rules";
import { getEmailAccount } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: prep buffer rule creation", () => {
  test(
    "creates a rule that adds prep time for investor meetings",
    async () => {
      const promptFile =
        "For investor meetings, block 30 minutes before for prep.";

      const result = await aiPromptToRules({
        emailAccount: getEmailAccount(),
        promptFile,
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].condition.aiInstructions?.toLowerCase()).toMatch(/investor|prep|buffer/);
      expect(result[0].condition.static).toBeFalsy();
    },
    TIMEOUT,
  );
});
