import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: read between the lines", () => {
  test(
    "flags potential escalation when reschedule language is stressed",
    async () => {
      const rules = [
        getRule("Routine reschedules", [], "Reschedule"),
        getRule("Escalations or sensitive client issues", [], "Escalation"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          from: "client@bigco.com",
          subject: "Can we push our call?",
          content:
            "Hey, can we push our call? Things are crazy here and I need to regroup.",
        }),
        emailAccount: getEmailAccount({
          about: "High-value enterprise client: BigCo",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("Escalations or sensitive client issues");
      expect(result.reason.toLowerCase()).toMatch(/crazy|regroup/);
    },
    TIMEOUT,
  );
});
