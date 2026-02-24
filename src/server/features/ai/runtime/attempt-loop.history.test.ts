import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import { buildRuntimeMessages, latestClarificationPrompt } from "@/server/features/ai/runtime/attempt-loop";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";

function makeSession(params: {
  message: string;
  messages?: ModelMessage[];
}): RuntimeSession {
  return {
    input: {
      message: params.message,
      messages: params.messages,
    },
  } as RuntimeSession;
}

describe("buildRuntimeMessages", () => {
  it("appends the current user turn when the same text appeared earlier but is not the latest message", () => {
    const session = makeSession({
      message: "try again",
      messages: [
        { role: "user", content: "try again" },
        { role: "assistant", content: "I searched but found nothing." },
      ],
    });

    const messages = buildRuntimeMessages(session);
    expect(messages).toHaveLength(3);
    expect(messages[2]).toEqual({ role: "user", content: "try again" });
  });

  it("does not append when the latest message already matches the current user turn", () => {
    const session = makeSession({
      message: "try again",
      messages: [
        { role: "assistant", content: "Anything else?" },
        { role: "user", content: "try again" },
      ],
    });

    const messages = buildRuntimeMessages(session);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({ role: "user", content: "try again" });
  });

  it("normalizes non-leading system messages for provider compatibility", () => {
    const session = makeSession({
      message: "show unread",
      messages: [
        { role: "user", content: "hello" },
        { role: "system", content: "Last turn tool evidence: []" },
      ],
    });

    const messages = buildRuntimeMessages(session);
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({
      role: "assistant",
      content: "Context note: Last turn tool evidence: []",
    });
    expect(messages[2]).toEqual({ role: "user", content: "show unread" });
  });

  it("normalizes leading system messages to assistant context notes", () => {
    const session = makeSession({
      message: "show unread",
      messages: [
        { role: "system", content: "Runtime policy from previous turn." },
        { role: "assistant", content: "Anything else?" },
      ],
    });

    const messages = buildRuntimeMessages(session);
    expect(messages[0]).toEqual({
      role: "assistant",
      content: "Context note: Runtime policy from previous turn.",
    });
    expect(messages.some((message) => message.role === "system")).toBe(false);
    expect(messages[2]).toEqual({ role: "user", content: "show unread" });
  });
});

describe("latestClarificationPrompt", () => {
  it("ignores stale clarification prompts when a later tool call succeeds", () => {
    const results: RuntimeToolResult[] = [
      {
        success: false,
        clarification: {
          kind: "invalid_fields",
          prompt: "email_date_range_invalid",
        },
      },
      {
        success: true,
        data: { count: 2 },
      },
    ];

    expect(latestClarificationPrompt(results)).toBeNull();
  });

  it("returns clarification prompt when no later success exists", () => {
    const results: RuntimeToolResult[] = [
      {
        success: false,
        clarification: {
          kind: "missing_fields",
          prompt: "email_date_range_missing",
        },
      },
    ];

    expect(latestClarificationPrompt(results)).toBe("email_date_range_missing");
  });

  it("does not return clarification when any successful evidence exists", () => {
    const results: RuntimeToolResult[] = [
      {
        success: true,
        data: { count: 1 },
      },
      {
        success: false,
        clarification: {
          kind: "missing_fields",
          prompt: "calendar_event_id_required",
        },
      },
    ];

    expect(latestClarificationPrompt(results)).toBeNull();
  });
});
