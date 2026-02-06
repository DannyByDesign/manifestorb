import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: lifecycle awareness", () => {
  test(
    "prioritizes strategic future planning requests",
    async () => {
      const rules = [
        getRule("Strategic planning", [], "Strategic"),
        getRule("Routine meeting", [], "Routine"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          subject: "January planning for 2025",
          content: "Can we meet in January to discuss 2025 planning?",
        }),
        emailAccount: getEmailAccount({
          about: "Strategic planning in Q1 is high priority.",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("Strategic");
      expect(result.reason.toLowerCase()).toMatch(/planning|2025/);
    },
    TIMEOUT,
  );
});
