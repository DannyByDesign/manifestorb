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

describe.runIf(isAiTest)("edge-case: calendar stalker", () => {
  test(
    "detects repetitive slot-grabbing pattern and suggests guardrails",
    async () => {
      const emails = makeThread([
        {
          from: "persistent@client.com",
          subject: "Quick call?",
          content: "Booked the only free slot again.",
        },
        {
          from: "persistent@client.com",
          subject: "Another quick call",
          content: "Grabbed the last open slot for Friday.",
        },
        {
          from: "persistent@client.com",
          subject: "One more",
          content: "Took the only available hour again.",
        },
      ]);

      const rules = [
        getRuleConfig(SystemType.CALENDAR),
        getRuleConfig(SystemType.NOTIFICATION),
      ];

      const result = await aiDetectRecurringPattern({
        emails,
        emailAccount: getEmailAccount({
          about: "Limit exploitative bookings; consider buffers for repeat offenders.",
        }),
        rules,
        logger,
      });

      expect(result).not.toBeNull();
      if (result) {
        expect(result.matchedRule).toBe(rules[0].name);
        expect(result.explanation.toLowerCase()).toMatch(/repeat|only slot/);
      }
    },
    TIMEOUT,
  );
});
