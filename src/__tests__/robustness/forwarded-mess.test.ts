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

describe.runIf(isAiTest)("edge-case: forwarded mess delegation", () => {
  test(
    "detects delegation intent and summarizes action items",
    async () => {
      const rule = getRule("Handle delegated requests", [], "Delegation");

      const originalEmail = makeParsedMessage({
        from: "manager@company.com",
        subject: "Fwd: Can you handle this?",
        textPlain:
          "Claude, can you handle this?\n\n---\nThread: We need a decision on the rollout timeline and who owns QA.",
      });

      const result = await processUserRequest({
        emailAccount: getEmailAccount(),
        rules: [rule],
        messages: [
          {
            role: "user",
            content:
              "Please summarize what I need to do and who I should respond to.",
          },
        ],
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
        expect(content).toMatch(/rollout/);
        expect(content).toMatch(/qa/);
        expect(content).toMatch(/decision/);
      }
    },
    TIMEOUT,
  );
});
