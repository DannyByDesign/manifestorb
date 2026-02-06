import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: relationship repair", () => {
  test(
    "flags personal response after long silence",
    async () => {
      const rules = [
        getRule("Personally respond to strained relationships", [], "Repair"),
        getRule("Routine follow-ups", [], "Routine"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          subject: "Checking back in",
          content:
            "Hey, it's been a while since I heard from you. Wanted to check in.",
        }),
        emailAccount: getEmailAccount({
          about: "This contact has been waiting for weeks.",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("Repair");
      expect(result.reason.toLowerCase()).toMatch(/weeks|while/);
    },
    TIMEOUT,
  );
});
