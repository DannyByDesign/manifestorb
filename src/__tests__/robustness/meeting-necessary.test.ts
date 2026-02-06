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

describe.runIf(isAiTest)("edge-case: should this be a meeting", () => {
  test(
    "suggests doc-first response when meeting is unnecessary",
    async () => {
      const rule = getRule("Draft replies", [], "Draft Reply");
      const originalEmail = makeParsedMessage({
        subject: "Sync on Q3 roadmap",
        textPlain:
          "Can we sync on the Q3 roadmap? I want to make sure I'm aligned.",
      });

      const result = await processUserRequest({
        emailAccount: getEmailAccount({
          about: "Roadmap is documented in the Q3 planning doc.",
        }),
        rules: [rule],
        messages: [
          {
            role: "user",
            content: "Reply with the best path forward.",
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
        expect(content).toMatch(/doc|roadmap/);
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
