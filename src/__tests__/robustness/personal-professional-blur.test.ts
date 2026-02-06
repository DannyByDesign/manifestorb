import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: personal/professional blur", () => {
  test(
    "treats school event as non-negotiable priority",
    async () => {
      const rules = [
        getRule("Personal commitments are non-negotiable", [], "Personal Priority"),
        getRule("Work meetings are default priority", [], "Work Priority"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          from: "school@district.edu",
          subject: "Parent-teacher conference scheduling",
          content:
            "Please pick a 30-minute slot for the parent-teacher conference next week.",
        }),
        emailAccount: getEmailAccount({
          about: "Family commitments are high priority.",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("Personal Priority");
      expect(result.reason.toLowerCase()).toMatch(/school|family/);
    },
    TIMEOUT,
  );
});
