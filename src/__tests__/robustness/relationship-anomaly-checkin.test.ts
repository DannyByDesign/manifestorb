import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: relationship anomaly", () => {
  test(
    "suggests check-in when a regular 1:1 suddenly stops",
    async () => {
      const rules = [
        getRule("Suggest check-in on anomalies", [], "Check-in"),
        getRule("Routine follow-ups", [], "Routine"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          subject: "Canceling again",
          content: "Canceling our 1:1 again this week.",
        }),
        emailAccount: getEmailAccount({
          about: "Six-month weekly 1:1 history; last three weeks canceled.",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("Check-in");
      expect(result.reason.toLowerCase()).toMatch(/cancel/);
      expect(result.reason.toLowerCase()).toMatch(/pattern/);
    },
    TIMEOUT,
  );
});
