import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiCheckIfNeedsReply } from "@/server/features/reply-tracker/ai/check-if-needs-reply";
import type { EmailForLLM } from "@/server/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("@/server/lib/llms", () => ({
  createGenerateObject: vi.fn(),
}));
vi.mock("@/server/lib/llms/model", () => ({
  getModel: vi.fn().mockReturnValue({ model: "mock", modelName: "mock" }),
}));

import { createGenerateObject } from "@/server/lib/llms";

const emailAccount = {
  id: "email-1",
  userId: "user-1",
  email: "user@example.com",
  account: { provider: "google" },
};

const messageToSend: EmailForLLM = {
  id: "msg-1",
  from: "sender@example.com",
  to: "user@example.com",
  subject: "Question",
  content: "Can we meet next week?",
};

describe("aiCheckIfNeedsReply error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a safe default when no message is provided", async () => {
    const result = await aiCheckIfNeedsReply({
      emailAccount: emailAccount as any,
      messageToSend: undefined as unknown as EmailForLLM,
      threadContextMessages: [],
    });

    expect(result.needsReply).toBe(false);
    expect(result.rationale).toBe("No message provided");
  });

  it("returns a safe default when LLM throws", async () => {
    vi.mocked(createGenerateObject).mockReturnValue(
      (async () => {
        throw new Error("LLM error");
      }) as any,
    );

    const result = await aiCheckIfNeedsReply({
      emailAccount: emailAccount as any,
      messageToSend,
      threadContextMessages: [],
    });

    expect(result.needsReply).toBe(false);
    expect(result.rationale).toBe("Error checking reply status");
  });
});
