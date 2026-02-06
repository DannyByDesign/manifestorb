import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: confidence calibration", () => {
  test(
    "acknowledges uncertainty when signals conflict",
    async () => {
      const rules = [
        getRule("Decline conflicting meetings", [], "Decline"),
        getRule("High priority exceptions", [], "High Priority"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          subject: "Important but conflicting request",
          content:
            "This is extremely important, but I know it's outside your usual hours.",
        }),
        emailAccount: getEmailAccount({
          about: "Strict rule against after-hours meetings unless critical.",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("Decline");
      expect(result.reason.toLowerCase()).toMatch(/uncertain|not sure/);
    },
    TIMEOUT,
  );
});
