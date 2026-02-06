import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: confidence calibration on conflict", () => {
  test(
    "signals uncertainty when priorities collide",
    async () => {
      const rules = [
        getRule("Strict decline after-hours", [], "Decline"),
        getRule("VIP exceptions allowed", [], "VIP Exception"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          subject: "Urgent request after hours",
          content: "I know it's late but this is urgent.",
        }),
        emailAccount: getEmailAccount({
          about: "After-hours meetings are discouraged unless critical.",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("Decline");
      expect(result.reason.toLowerCase()).toMatch(/uncertain|not sure/);
    },
    TIMEOUT,
  );
});
