import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: timezone chaos", () => {
  test(
    "asks for timezone clarification when travel context conflicts",
    async () => {
      const rules = [
        getRule("Clarify timezones before scheduling", [], "Clarify TZ"),
        getRule("Schedule meeting", [], "Schedule"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          from: "client@london.co.uk",
          subject: "Next Thursday at 3pm?",
          content:
            "Can we meet next Thursday at 3pm? I'm in London.",
        }),
        emailAccount: getEmailAccount({
          about: "In SF, traveling to NYC next week",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("Clarify TZ");
      expect(result.reason.toLowerCase()).toMatch(/timezone|time zone/);
    },
    TIMEOUT,
  );
});
