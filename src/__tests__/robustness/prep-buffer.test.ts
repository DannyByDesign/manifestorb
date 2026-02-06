import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: prep buffer", () => {
  test(
    "suggests prep time for high-stakes meetings",
    async () => {
      const rules = [
        getRule("Investor meetings require prep buffer", [], "Prep Buffer"),
        getRule("Standard scheduling", [], "Standard"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          subject: "Investor meeting request",
          content: "Can we meet about the seed round next week?",
        }),
        emailAccount: getEmailAccount({
          about: "Investor meetings require 30 minutes prep.",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("Prep Buffer");
      expect(result.reason.toLowerCase()).toMatch(/prep|buffer/);
    },
    TIMEOUT,
  );
});
