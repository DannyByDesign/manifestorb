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

describe.runIf(isAiTest)("edge-case: cultural context", () => {
  test(
    "adapts tone between formal and casual requests",
    async () => {
      const rule = getRule("Draft replies", [], "Draft Reply");

      const formalEmail = makeParsedMessage({
        from: "client@jpco.jp",
        subject: "Meeting request",
        textPlain:
          "We would be honored to request a meeting at your earliest convenience.",
      });

      const casualEmail = makeParsedMessage({
        from: "founder@startup.io",
        subject: "coffee tmrw?",
        textPlain: "coffee tmrw? quick sync?",
      });

      const formalResult = await processUserRequest({
        emailAccount: getEmailAccount(),
        rules: [rule],
        messages: [{ role: "user", content: "Draft a reply." }],
        originalEmail: formalEmail,
        matchedRule: rule,
        logger,
      });

      const casualResult = await processUserRequest({
        emailAccount: getEmailAccount(),
        rules: [rule],
        messages: [{ role: "user", content: "Draft a reply." }],
        originalEmail: casualEmail,
        matchedRule: rule,
        logger,
      });

      const formalToolCalls = getToolCalls(formalResult.steps);
      const casualToolCalls = getToolCalls(casualResult.steps);
      const formalReply = formalToolCalls.find((toolCall) => toolCall.toolName === "reply");
      const casualReply = casualToolCalls.find((toolCall) => toolCall.toolName === "reply");
      expect(formalReply).toBeDefined();
      expect(casualReply).toBeDefined();

      if (formalReply && casualReply && isRecord(formalReply.input) && isRecord(casualReply.input)) {
        const formalContent =
          typeof formalReply.input.content === "string"
            ? formalReply.input.content.toLowerCase()
            : "";
        const casualContent =
          typeof casualReply.input.content === "string"
            ? casualReply.input.content.toLowerCase()
            : "";

        expect(formalContent).toMatch(/dear|sincerely/);
        expect(casualContent).toMatch(/hey|can't|let's/);
        expect(formalContent).not.toMatch(/hey|yo/);
        expect(casualContent).not.toMatch(/sincerely|dear/);
      }
    },
    TIMEOUT,
  );
});
