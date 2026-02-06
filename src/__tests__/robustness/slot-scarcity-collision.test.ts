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

describe.runIf(isAiTest)("edge-case: everyone wants this slot", () => {
  test(
    "asks for prioritization when slot demand exceeds supply",
    async () => {
      const rule = getRule("Resolve competing requests", [], "Resolve Requests");
      const originalEmail = makeParsedMessage({
        subject: "All want Friday at 4pm",
        textPlain:
          "VIP, partner, and recruiter all want Friday at 4pm. Only one slot open.",
      });

      const result = await processUserRequest({
        emailAccount: getEmailAccount(),
        rules: [rule],
        messages: [
          { role: "user", content: "Help choose who gets the slot." },
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
        expect(content).toMatch(/priority|rank|choose/);
      }

      const schedulingCall = toolCalls.find((toolCall) =>
        toolCall.toolName.toLowerCase().includes("schedule"),
      );
      expect(schedulingCall).toBeUndefined();
    },
    TIMEOUT,
  );
});
