import { describe, expect, test, vi } from "vitest";
import { aiChooseRule } from "@/features/rules/ai/ai-choose-rule";
import { aiPromptToRules } from "@/features/rules/ai/prompts/prompt-to-rules";
import { aiDetectRecurringPattern } from "@/features/rules/ai/ai-detect-recurring-pattern";
import { processUserRequest } from "@/features/web-chat/ai/process-user-request";
import { getRuleConfig, getRuleName } from "@/features/rules/consts";
import { SystemType } from "@/generated/prisma/enums";
import { getEmailAccount, getEmail, getRule } from "@/__tests__/helpers";
import { createScopedLogger } from "@/server/lib/logger";
import type {
  EmailForLLM,
  ParsedMessage,
  ParsedMessageHeaders,
} from "@/server/lib/types";

// Run with: bun test-ai ai-robustness

const logger = createScopedLogger("test");
const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));
vi.mock("@/server/lib/gmail/mail", () => ({ replyToEmail: vi.fn() }));

type ToolCall = { toolName: string; input?: unknown };

function getToolCalls(steps: Array<{ toolCalls?: Array<ToolCall | undefined> }>) {
  return steps
    .flatMap((step) => step.toolCalls ?? [])
    .filter((call): call is ToolCall => Boolean(call));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getParsedMessage({
  id = "msg-1",
  threadId = "thread-1",
  from = "sender@example.com",
  to = "user@example.com",
  subject = "Subject",
  textPlain = "Body",
}: {
  id?: string;
  threadId?: string;
  from?: string;
  to?: string;
  subject?: string;
  textPlain?: string;
}): ParsedMessage {
  const headers: ParsedMessageHeaders = {
    from,
    to,
    subject,
    date: new Date().toISOString(),
  };

  return {
    id,
    threadId,
    historyId: "history-1",
    headers,
    snippet: textPlain,
    textPlain,
    textHtml: `<p>${textPlain}</p>`,
    attachments: [],
    inline: [],
    labelIds: [],
    subject,
    date: new Date().toISOString(),
  };
}

describe.runIf(isAiTest)("AI robustness scenarios", () => {
  test(
    "conflicting rules choose specific rule without explicit priority",
    async () => {
      const rules = [
        getRule("No meetings before 10am", [], "No meetings before 10am"),
        getRule(
          "Always accommodate John's schedule, he's our biggest client",
          [],
          "Accommodate John",
        ),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          from: "john@bigclient.com",
          subject: "Can we do 9am?",
          content: "I'm only free at 9am. Can we meet then?",
        }),
        emailAccount: getEmailAccount(),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule).toEqual(rules[1]);
      expect(primary?.rule).not.toEqual(rules[0]);
      expect(result.reason).toBeTruthy();
    },
    TIMEOUT,
  );

  test(
    "temporary exception updates instructions with time-bound language",
    async () => {
      const rule = getRule(
        "Block Fridays for deep work",
        [],
        "Focus Friday",
      );

      const result = await processUserRequest({
        emailAccount: getEmailAccount(),
        rules: [rule],
        messages: [
          {
            role: "user",
            content:
              "Actually this week I can take meetings Friday, I'm traveling next week.",
          },
        ],
        originalEmail: getParsedMessage({
          subject: "Friday availability",
          textPlain: "Can we do Friday morning?",
        }),
        matchedRule: rule,
        logger,
      });

      const toolCalls = getToolCalls(result.steps);
      const updateInstructions = toolCalls.find(
        (toolCall) => toolCall.toolName === "update_ai_instructions",
      );
      const replyCall = toolCalls.find(
        (toolCall) => toolCall.toolName === "reply",
      );

      expect(updateInstructions).toBeTruthy();
      expect(replyCall).toBeTruthy();

      if (updateInstructions && isRecord(updateInstructions.input)) {
        const input = updateInstructions.input;
        const aiInstructions = typeof input.aiInstructions === "string"
          ? input.aiInstructions.toLowerCase()
          : "";

        expect(input.ruleName).toBe("Focus Friday");
        expect(aiInstructions).toMatch(/this week|this friday|friday|april/);
      }

      if (replyCall && isRecord(replyCall.input)) {
        const content =
          typeof replyCall.input.content === "string"
            ? replyCall.input.content.toLowerCase()
            : "";
        expect(content).toMatch(/this week|one-off|exception/);
      }
    },
    TIMEOUT,
  );

  test(
    "implicit scheduling pattern suggests a calendar rule",
    async () => {
      const emails: EmailForLLM[] = Array.from({ length: 6 }).map((_, i) => ({
        id: `reschedule-${i}`,
        from: "client@example.com",
        to: "user@example.com",
        subject: `Reschedule request ${i + 1}`,
        content:
          "Can we reschedule to the afternoon? Morning doesn't work this week.",
        date: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
      }));

      const rules = [
        getRuleConfig(SystemType.CALENDAR),
        getRuleConfig(SystemType.TO_REPLY),
      ];

      const result = await aiDetectRecurringPattern({
        emails,
        emailAccount: getEmailAccount(),
        rules,
        logger,
      });

      expect(result?.matchedRule).toBe(getRuleName(SystemType.CALENDAR));
      expect(result?.explanation.toLowerCase()).toMatch(/afternoon|reschedule/);
    },
    TIMEOUT,
  );

  test(
    "vague instruction produces a minimal focus rule without hard-coded schedule",
    async () => {
      const result = await aiPromptToRules({
        emailAccount: getEmailAccount(),
        promptFile: "I need more focus time.",
      });

      expect(result.length).toBeGreaterThan(0);
      const rule = result[0];
      expect(rule.condition.aiInstructions?.toLowerCase()).toContain("focus");
      expect(rule.condition.aiInstructions?.toLowerCase()).toContain("block time");
      expect(rule.condition.static).toBeFalsy();
    },
    TIMEOUT,
  );

  test(
    "natural language override does not blindly rewrite rule",
    async () => {
      const rule = getRule(
        "No meetings after 5pm",
        [],
        "No meetings after 5pm",
      );

      const result = await processUserRequest({
        emailAccount: getEmailAccount(),
        rules: [rule],
        messages: [
          {
            role: "user",
            content: "6pm works.",
          },
        ],
        originalEmail: getParsedMessage({
          subject: "Timezone request",
          textPlain: "Can we do 6pm? It's the only time that works.",
        }),
        matchedRule: rule,
        logger,
      });

      const toolCalls = getToolCalls(result.steps);
      const updateCall = toolCalls.find(
        (toolCall) => toolCall.toolName === "update_ai_instructions",
      );
      const replyCall = toolCalls.find(
        (toolCall) => toolCall.toolName === "reply",
      );

      if (updateCall && isRecord(updateCall.input)) {
        const instructions =
          typeof updateCall.input.aiInstructions === "string"
            ? updateCall.input.aiInstructions.toLowerCase()
            : "";
        expect(instructions).toMatch(
          /exception|one-off|this time|one time|unless|explicitly confirm/,
        );
        expect(instructions).toMatch(/after 5pm/);
      }

      if (replyCall && isRecord(replyCall.input)) {
        const content =
          typeof replyCall.input.content === "string"
            ? replyCall.input.content.toLowerCase()
            : "";
        expect(content).toMatch(/exception|one-off|confirm/);
      }
    },
    TIMEOUT,
  );

  test(
    "rule discoverability: still enforces older rule among many",
    async () => {
      const rules = Array.from({ length: 15 }).map((_, i) =>
        getRule(`Rule ${i}`, [], `Rule ${i}`),
      );
      const targetRule = getRule(
        "No meetings after 5pm",
        [],
        "No meetings after 5pm",
      );
      rules.splice(7, 0, targetRule);

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          subject: "6pm meeting request",
          content: "Can we do 6pm? That's the only time my timezone allows.",
        }),
        emailAccount: getEmailAccount(),
      });

      const primary = result.rules.find((rule) => rule.isPrimary) ?? result.rules[0];
      expect(primary?.rule.name).toBe("No meetings after 5pm");
    },
    TIMEOUT,
  );

  test(
    "explanation includes human-facing reasoning without system leakage",
    async () => {
      const rules = [
        getRule("Match emails about finance", [], "Finance"),
      ];

      const result = await aiChooseRule({
        rules,
        email: getEmail({
          subject: "Invoice for March",
          content: "Please find attached the invoice for March.",
        }),
        emailAccount: getEmailAccount(),
      });

      const reasoning = result.reason.toLowerCase();
      expect(reasoning.length).toBeGreaterThan(0);
      expect(reasoning).not.toContain("system");
      expect(reasoning).not.toContain("prompt");
    },
    TIMEOUT,
  );

  test(
    "adversarial contradictions prompt clarification rather than silent edits",
    async () => {
      const rule = getRule(
        "No meetings on Tuesdays",
        [],
        "No Tuesdays",
      );

      const result = await processUserRequest({
        emailAccount: getEmailAccount(),
        rules: [rule],
        messages: [
          {
            role: "user",
            content:
              "Schedule nothing on Tuesdays. Actually, schedule Sarah on Tuesday. Actually, no meetings with anyone named Sarah.",
          },
        ],
        originalEmail: getParsedMessage({
          subject: "Scheduling request",
          textPlain: "Can you schedule Sarah next Tuesday?",
        }),
        matchedRule: rule,
        logger,
      });

      const toolCalls = getToolCalls(result.steps);
      const replyCall = toolCalls.find(
        (toolCall) => toolCall.toolName === "reply",
      );
      const updateCall = toolCalls.find(
        (toolCall) => toolCall.toolName === "update_ai_instructions",
      );

      if (replyCall && isRecord(replyCall.input)) {
        const content =
          typeof replyCall.input.content === "string"
            ? replyCall.input.content
            : "";
        expect(content).toContain("?");
      }

      expect(updateCall).toBeUndefined();
    },
    TIMEOUT,
  );

  test(
    "ambiguous scheduling asks for clarification over action",
    async () => {
      const rule = getRule(
        "Clarify ambiguous scheduling requests",
        [],
        "Clarify Scheduling",
      );

      const result = await processUserRequest({
        emailAccount: getEmailAccount({
          about: "Traveling between SF and NYC next week.",
        }),
        rules: [rule],
        messages: [{ role: "user", content: "Draft a reply." }],
        originalEmail: getParsedMessage({
          subject: "Next Thursday at 3pm",
          textPlain: "Next Thursday at 3pm works for me.",
        }),
        matchedRule: rule,
        logger,
      });

      const toolCalls = getToolCalls(result.steps);
      const replyCall = toolCalls.find(
        (toolCall) => toolCall.toolName === "reply",
      );
      const schedulingCall = toolCalls.find((toolCall) =>
        toolCall.toolName.toLowerCase().includes("schedule"),
      );

      expect(replyCall).toBeDefined();
      expect(schedulingCall).toBeUndefined();

      if (replyCall && isRecord(replyCall.input)) {
        const content =
          typeof replyCall.input.content === "string"
            ? replyCall.input.content.toLowerCase()
            : "";
        expect(content).toMatch(/\?/);
      }
    },
    TIMEOUT,
  );
});
