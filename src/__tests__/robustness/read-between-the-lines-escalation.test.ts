import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: escalation cues", () => {
  test(
    "prefers escalation rule when language signals stress",
    async () => {
      const rules = [
        getRule("Escalation follow-up", [], "Escalation"),
        getRule("Routine reschedule", [], "Routine Reschedule"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          subject: "Need to move our call",
          content: "Things are chaotic here. Can we push?",
        }),
        emailAccount: getEmailAccount({
          about: "Client is a key account, watch for churn risk.",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("Escalation");
      expect(result.reason.toLowerCase()).toMatch(/chaotic|stress/);
    },
    TIMEOUT,
  );
});
