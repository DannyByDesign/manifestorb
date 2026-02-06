import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";

const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: VIP follow-up", () => {
  test(
    "prioritizes VIP follow-up when no RSVP",
    async () => {
      const rules = [
        getRule("VIP follow-up", [], "VIP Follow-up"),
        getRule("Standard reminder", [], "Reminder"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          subject: "Confirming tomorrow?",
          content: "Checking in on tomorrow's meeting. No reply yet.",
        }),
        emailAccount: getEmailAccount({
          about: "VIP CEO has a history of missing RSVPs.",
        }),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("VIP Follow-up");
      expect(result.reason.toLowerCase()).toMatch(/vip|priority/);
    },
    TIMEOUT,
  );
});
