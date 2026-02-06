import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: emergency interrupt", () => {
  test(
    "prioritizes emergencies over do-not-disturb",
    async () => {
      const rules = [
        getRule("Do not disturb during focus blocks", [], "DND"),
        getRule("Emergency escalation", [], "Emergency"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          subject: "Server is down",
          content: "Production server is down. Need you now.",
        }),
        emailAccount: getEmailAccount({
          about: "Currently in do-not-disturb focus mode.",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("Emergency");
      expect(result.reason.toLowerCase()).toMatch(/emergency|down/);
    },
    TIMEOUT,
  );
});
