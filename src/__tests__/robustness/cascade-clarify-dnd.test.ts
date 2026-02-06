import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: DND override with emergencies", () => {
  test(
    "chooses emergency rule when DND is active",
    async () => {
      const rules = [
        getRule("DND: no interruptions", [], "DND"),
        getRule("Emergency override", [], "Emergency"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          subject: "Incident response",
          content: "We have an outage. Need you immediately.",
        }),
        emailAccount: getEmailAccount({
          about: "Currently in DND mode.",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("Emergency");
      expect(result.reason.toLowerCase()).toMatch(/outage|urgent/);
    },
    TIMEOUT,
  );
});
