import { describe, expect, it } from "vitest";
import { runSerializedConversationTurn } from "./runtime";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("channels runtime serialization", () => {
  it("serializes turns for the same conversation key", async () => {
    const events: string[] = [];

    const first = runSerializedConversationTurn({
      queueKey: "user:slack:channel:thread",
      provider: "slack",
      channelId: "channel",
      threadId: "thread",
      execute: async () => {
        events.push("start-1");
        await sleep(25);
        events.push("end-1");
        return "first";
      },
    });

    const second = runSerializedConversationTurn({
      queueKey: "user:slack:channel:thread",
      provider: "slack",
      channelId: "channel",
      threadId: "thread",
      execute: async () => {
        events.push("start-2");
        events.push("end-2");
        return "second";
      },
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe("first");
    expect(secondResult).toBe("second");
    expect(events).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });
});
