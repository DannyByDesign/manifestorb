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

describe.runIf(isAiTest)("edge-case: vacation override", () => {
  test(
    "does not relax OOO rule after a quick reply",
    async () => {
      const rule = getRule("Out of office next week", [], "OOO");
      const originalEmail = makeParsedMessage({
        subject: "Quick contract question",
        textPlain: "Quick question about the contract while you're OOO.",
      });

      const result = await processUserRequest({
        emailAccount: getEmailAccount({
          about: "Out of office next week.",
        }),
        rules: [rule],
        messages: [
          {
            role: "user",
            content: "I replied because it was quick. Keep OOO for everything else.",
          },
        ],
        originalEmail,
        matchedRule: rule,
        logger,
      });

      const toolCalls = getToolCalls(result.steps);
      const updateCall = toolCalls.find(
        (toolCall) => toolCall.toolName === "update_ai_instructions",
      );
      expect(updateCall).toBeUndefined();

      const replyCall = toolCalls.find((toolCall) => toolCall.toolName === "reply");
      expect(replyCall).toBeDefined();

      if (replyCall && isRecord(replyCall.input)) {
        const content =
          typeof replyCall.input.content === "string"
            ? replyCall.input.content.toLowerCase()
            : "";
        expect(content).toMatch(/out of office|ooo/);
      }
    },
    TIMEOUT,
  );
});
