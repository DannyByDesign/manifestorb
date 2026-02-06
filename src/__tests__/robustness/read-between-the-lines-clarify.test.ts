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

describe.runIf(isAiTest)("edge-case: escalation clarification", () => {
  test(
    "asks for context when language hints at escalation",
    async () => {
      const rule = getRule("Draft replies", [], "Draft Reply");
      const originalEmail = makeParsedMessage({
        subject: "Reschedule?",
        textPlain:
          "Hey, things are crazy. Can we push our call? Might need to chat.",
      });

      const result = await processUserRequest({
        emailAccount: getEmailAccount({
          about: "High-value client: watch for escalation.",
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
        expect(content).toMatch(/everything ok|support/);
        expect(content).toMatch(/\?/);
      }

      const updateCall = toolCalls.find(
        (toolCall) => toolCall.toolName === "update_ai_instructions",
      );
      expect(updateCall).toBeUndefined();
    },
    TIMEOUT,
  );
});
