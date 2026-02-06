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

describe.runIf(isAiTest)("edge-case: clarify timezone options", () => {
  test(
    "offers timezone clarification instead of committing",
    async () => {
      const rule = getRule("Clarify timezones", [], "Clarify");
      const originalEmail = makeParsedMessage({
        subject: "Next Thursday at 3pm",
        textPlain: "Next Thursday at 3pm works for me.",
      });

      const result = await processUserRequest({
        emailAccount: getEmailAccount({
          about: "Traveling between SF and NYC next week.",
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
        expect(content).toMatch(/time zone/);
        expect(content).toMatch(/\?/);
      }

      const schedulingCall = toolCalls.find((toolCall) =>
        toolCall.toolName.toLowerCase().includes("schedule"),
      );
      expect(schedulingCall).toBeUndefined();
    },
    TIMEOUT,
  );
});
