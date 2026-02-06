import { describe, expect, test, vi } from "vitest";
import { aiDetectRecurringPattern } from "@/features/rules/ai/ai-detect-recurring-pattern";
import { getEmailAccount } from "@/__tests__/helpers";
import { getRuleConfig, getRuleName } from "@/features/rules/consts";
import { SystemType } from "@/generated/prisma/enums";
import { createScopedLogger } from "@/server/lib/logger";
import { makeThread } from "./helpers";

const logger = createScopedLogger("test");
const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));

describe.runIf(isAiTest)("edge-case: pattern break detection", () => {
  test(
    "flags anomaly after repeated cancellations of a long-standing 1:1",
    async () => {
      const emails = makeThread([
        {
          from: "direct@company.com",
          subject: "1:1 Monday 2pm",
          content: "Confirming our weekly 1:1 on Monday at 2pm.",
        },
        {
          from: "direct@company.com",
          subject: "Canceling again",
          content: "Sorry, need to cancel this week.",
        },
        {
          from: "direct@company.com",
          subject: "Canceling again",
          content: "Another conflict, can we skip?",
        },
        {
          from: "direct@company.com",
          subject: "Canceling again",
          content: "Still need to cancel this week.",
        },
      ]);

      const rules = [
        getRuleConfig(SystemType.FYI),
        getRuleConfig(SystemType.TO_REPLY),
      ];

      const result = await aiDetectRecurringPattern({
        emails,
        emailAccount: getEmailAccount({
          about: "Weekly 1:1s are normally consistent and important.",
        }),
        rules,
        logger,
      });

      expect(result).not.toBeNull();
      if (result) {
        expect(result.matchedRule).toBeDefined();
        expect(result.explanation.toLowerCase()).toMatch(/cancel/);
        expect(result.explanation.toLowerCase()).toMatch(/pattern|anomaly/);
      }
    },
    TIMEOUT,
  );
});
