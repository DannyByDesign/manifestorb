import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import { buildRuntimeMessages } from "@/server/features/ai/runtime/attempt-loop";

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
});
