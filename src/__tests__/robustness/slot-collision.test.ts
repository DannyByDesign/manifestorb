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

describe.runIf(isAiTest)("edge-case: slot collision", () => {
  test(
    "asks for prioritization when multiple requests target the same slot",
    async () => {
      const rule = getRule("Resolve scheduling collisions", [], "Collision Resolver");
      const originalEmail = makeParsedMessage({
        subject: "Three requests for Friday 2pm",
        textPlain:
          "Three people asked for Friday 2pm: VIP client, teammate, and recruiter.",
      });

      const result = await processUserRequest({
        emailAccount: getEmailAccount(),
        rules: [rule],
        messages: [
          {
            role: "user",
            content:
              "We have three requests for the same slot. Help decide.",
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
        expect(content).toMatch(/which|priority|choose/);
      }

      const schedulingCall = toolCalls.find((toolCall) =>
        toolCall.toolName.toLowerCase().includes("schedule"),
      );
      expect(schedulingCall).toBeUndefined();
    },
    TIMEOUT,
  );
});
