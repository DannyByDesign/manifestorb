import { describe, expect, test, vi } from "vitest";
import { aiDetectRecurringPattern } from "@/features/rules/ai/ai-detect-recurring-pattern";
import { getEmailAccount } from "@/__tests__/helpers";
import { getRuleConfig } from "@/features/rules/consts";
import { SystemType } from "@/generated/prisma/enums";
import { createScopedLogger } from "@/server/lib/logger";
import { makeThread } from "./helpers";

const logger = createScopedLogger("test");
const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: implicit rule extraction", () => {
  test(
    "detects afternoon preference pattern for scheduling",
    async () => {
      const emails = makeThread([
        {
          from: "assistant@example.com",
          subject: "Reschedule to afternoon",
          content: "Can we move this to the afternoon instead of morning?",
        },
        {
          from: "assistant@example.com",
          subject: "Prefer afternoon",
          content: "Afternoons work best for me this week.",
        },
        {
          from: "assistant@example.com",
          subject: "Shift later",
          content: "Can we move this later in the day?",
        },
      ]);

      const rules = [
        getRuleConfig(SystemType.CALENDAR),
        getRuleConfig(SystemType.TO_REPLY),
      ];

      const result = await aiDetectRecurringPattern({
        emails,
        emailAccount: getEmailAccount(),
        rules,
        logger,
      });

      expect(result).not.toBeNull();
      if (result) {
        expect(result.matchedRule).toBe(rules[0].name);
        expect(result.explanation.toLowerCase()).toMatch(/afternoon|later/);
      }
    },
    TIMEOUT,
  );
});
