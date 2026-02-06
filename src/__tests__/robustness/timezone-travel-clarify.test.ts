import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: travel time ambiguity", () => {
  test(
    "prefers clarification when time zone context is ambiguous",
    async () => {
      const rules = [
        getRule("Ask for timezone clarification", [], "Clarify TZ"),
        getRule("Confirm meeting time", [], "Confirm"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          subject: "Next Thursday at 3pm",
          content: "Next Thursday at 3pm works for me.",
        }),
        emailAccount: getEmailAccount({
          about: "Based in SF, traveling to NYC next week.",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("Clarify TZ");
      expect(result.reason.toLowerCase()).toMatch(/timezone|travel/);
    },
    TIMEOUT,
  );
});
