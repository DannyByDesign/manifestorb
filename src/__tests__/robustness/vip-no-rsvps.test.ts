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

describe.runIf(isAiTest)("edge-case: VIP never RSVPs", () => {
  test(
    "flags a follow-up pattern for a VIP who never confirms",
    async () => {
      const emails = makeThread([
        {
          from: "assistant@example.com",
          subject: "Meeting tomorrow?",
          content: "Just confirming tomorrow's meeting.",
        },
        {
          from: "assistant@example.com",
          subject: "Checking in",
          content: "Still waiting on confirmation for tomorrow.",
        },
        {
          from: "assistant@example.com",
          subject: "Reminder",
          content: "Let me know if we're still on.",
        },
      ]);

      const rules = [
        getRuleConfig(SystemType.AWAITING_REPLY),
        getRuleConfig(SystemType.TO_REPLY),
      ];

      const result = await aiDetectRecurringPattern({
        emails,
        emailAccount: getEmailAccount({
          about: "VIP: CEO never confirms but expects reminders",
        }),
        rules,
        logger,
      });

      expect(result?.matchedRule).toBe(getRuleName(SystemType.AWAITING_REPLY));
      expect(result?.explanation.toLowerCase()).toMatch(/waiting|confirmation|reminder/);
    },
    TIMEOUT,
  );
});
