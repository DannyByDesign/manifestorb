import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: calendar is lying", () => {
  test(
    "asks whether a placeholder block is flexible",
    async () => {
      const rules = [
        getRule("Clarify placeholder conflicts", [], "Clarify Placeholder"),
        getRule("Decline conflicting meetings", [], "Decline"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          subject: "Wednesday meeting request",
          content:
            "Can we do Wednesday at 2pm? I see you have a dentist placeholder sometime this week.",
        }),
        emailAccount: getEmailAccount({
          about: "Calendar includes soft placeholders like 'dentist sometime this week'.",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("Clarify Placeholder");
      expect(result.reason.toLowerCase()).toMatch(/placeholder|flexible/);
      expect(primary?.rule.name).not.toBe("Decline");
    },
    TIMEOUT,
  );
});
