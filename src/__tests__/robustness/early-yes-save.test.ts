import { describe, expect, test, vi } from "vitest";
import { processUserRequest } from "@/features/web-chat/ai/process-user-request";
import { getEmailAccount, getRule } from "@/__tests__/helpers";
import { createScopedLogger } from "@/server/lib/logger";
import { makeParsedMessage, getToolCalls, isRecord } from "./helpers";

const logger = createScopedLogger("test");
const TIMEOUT = 25_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));
vi.mock("@/server/lib/gmail/mail", () => ({ replyToEmail: vi.fn() }));

describe.runIf(isAiTest)("edge-case: I said yes but shouldn't have", () => {
  test(
    "suggests rescheduling despite manual acceptance",
    async () => {
      const rule = getRule("No early meetings", [], "No early meetings");
      const originalEmail = makeParsedMessage({
        subject: "8am meeting accepted",
        textPlain:
          "I accepted an 8am meeting even though it violates my no-early rule.",
      });

      const result = await processUserRequest({
        emailAccount: getEmailAccount({
          about: "Early meetings cause poor outcomes.",
        }),
        rules: [rule],
        messages: [{ role: "user", content: "What should I do?" }],
        originalEmail,
        matchedRule: rule,
        logger,
      });

      const toolCalls = getToolCalls(result.steps);
      const replyCall = toolCalls.find((toolCall) => toolCall.toolName === "reply");
      expect(replyCall).toBeDefined();

      if (replyCall && isRecord(replyCall.input)) {
        const content =
          typeof replyCall.input.content === "string"
            ? replyCall.input.content.toLowerCase()
            : "";
        expect(content).toMatch(/reschedule|move later/);
        expect(content).toMatch(/early|morning|8am/);
      }
    },
    TIMEOUT,
  );
});
