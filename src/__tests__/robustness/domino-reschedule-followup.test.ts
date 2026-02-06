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

describe.runIf(isAiTest)("edge-case: domino reschedule", () => {
  test(
    "suggests earlier moves or asks approval after cancellations",
    async () => {
      const rule = getRule("Optimize schedule after cancellations", [], "Optimize");
      const originalEmail = makeParsedMessage({
        subject: "Meeting A canceled",
        textPlain:
          "Meeting A got canceled; Meeting B is now late and Meeting C could be earlier.",
      });

      const result = await processUserRequest({
        emailAccount: getEmailAccount({
          about: "Prefer to wrap by 6pm; avoid late meetings.",
        }),
        rules: [rule],
        messages: [{ role: "user", content: "What should we do?" }],
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
        expect(content).toMatch(/move earlier|reschedule/);
        expect(content).toMatch(/approval|option/);
      }
    },
    TIMEOUT,
  );
});
