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

describe.runIf(isAiTest)("edge-case: placeholder flexibility", () => {
  test(
    "asks before declining if conflict is a placeholder",
    async () => {
      const rule = getRule("Clarify soft holds", [], "Clarify Soft Holds");
      const originalEmail = makeParsedMessage({
        subject: "Meeting on Wednesday?",
        textPlain: "Can we meet Wednesday? I saw a 'Dentist sometime this week' block.",
      });

      const result = await processUserRequest({
        emailAccount: getEmailAccount({
          about: "Calendar uses placeholders as soft holds.",
        }),
        rules: [rule],
        messages: [{ role: "user", content: "Draft a response." }],
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
        expect(content).toMatch(/placeholder|flexible/);
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
