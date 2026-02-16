import { describe, expect, it } from "vitest";
import { pruneRuntimeMessages } from "@/server/features/ai/runtime/context/pruning";

describe("runtime message pruning", () => {
  it("preserves all user messages while pruning assistant/tool history", () => {
    const messages = [
      { role: "user", content: "u1".repeat(200) },
      { role: "assistant", content: "a1".repeat(300) },
      { role: "tool", content: "t1".repeat(300) },
      { role: "assistant", content: "a2".repeat(300) },
      { role: "user", content: "u2".repeat(200) },
      { role: "assistant", content: "tail".repeat(120) },
    ] as const;

    const result = pruneRuntimeMessages({
      messages: messages as any,
      mode: "hard",
      config: {
        softLimitChars: 1500,
        hardLimitChars: 900,
        protectedAssistantTail: 1,
        minAssistantChars: 60,
      },
    });

    const userMessages = result.messages.filter((message) => message.role === "user");
    expect(userMessages).toHaveLength(2);
    expect(result.pruned).toBe(true);
  });

  it("is a no-op when under budget", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ] as const;

    const result = pruneRuntimeMessages({
      messages: messages as any,
      mode: "soft",
      config: {
        softLimitChars: 1000,
        hardLimitChars: 800,
        protectedAssistantTail: 1,
        minAssistantChars: 60,
      },
    });

    expect(result.pruned).toBe(false);
    expect(result.mode).toBe("none");
    expect(result.messages).toEqual(messages);
  });
});
