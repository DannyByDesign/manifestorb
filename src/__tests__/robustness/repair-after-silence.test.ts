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

describe.runIf(isAiTest)("edge-case: relationship repair follow-up", () => {
  test(
    "suggests a personal response after long silence",
    async () => {
      const rule = getRule("Personal responses to long silence", [], "Repair");
      const originalEmail = makeParsedMessage({
        subject: "Just checking in",
        textPlain: "It's been a few weeks since I heard from you.",
      });

      const result = await processUserRequest({
        emailAccount: getEmailAccount({
          about: "This person hasn't heard from me in weeks.",
        }),
        rules: [rule],
        messages: [{ role: "user", content: "Draft a reply." }],
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
        expect(content).toMatch(/sorry/);
        expect(content).toMatch(/catch up/);
      }

      const updateCall = toolCalls.find(
        (toolCall) => toolCall.toolName === "update_ai_instructions",
      );
      expect(updateCall).toBeUndefined();
    },
    TIMEOUT,
  );
});
