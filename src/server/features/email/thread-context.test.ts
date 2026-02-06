import { describe, expect, it, vi, beforeEach } from "vitest";
import { aiCollectReplyContext } from "@/features/reply-tracker/ai/reply-context-collector";
import type { EmailForLLM } from "@/server/lib/types";
import type { EmailProvider } from "@/features/email/types";

vi.mock("server-only", () => ({}));
vi.mock("@/server/lib/llms", () => ({
  createGenerateText: vi.fn(),
}));
vi.mock("@/server/lib/llms/model", () => ({
  getModel: vi.fn().mockReturnValue({ model: "mock", modelName: "mock" }),
}));

import { createGenerateText } from "@/server/lib/llms";

const createThreadMessages = (count: number): EmailForLLM[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `msg-${index + 1}`,
    from: "sender@example.com",
    to: "user@example.com",
    subject: "Proposal discussion",
    content: `Message ${index + 1}`,
  }));

describe("aiCollectReplyContext fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createGenerateText).mockReturnValue(async () => ({
      steps: [],
    }) as unknown as () => Promise<{ steps: Array<unknown> }>);
  });

  it("returns subject-based fallback results for long threads", async () => {
    const emailProvider = {
      name: "google",
      getMessagesWithPagination: vi.fn().mockResolvedValue({
        messages: [
          {
            subject: "Proposal discussion",
            snippet: "Following up on the proposal",
          },
        ],
      }),
    } as unknown as EmailProvider;

    const result = await aiCollectReplyContext({
      currentThread: createThreadMessages(15),
      emailAccount: {
        id: "email-1",
        email: "user@example.com",
        userId: "user-1",
        account: { provider: "google" },
      } as unknown as object,
      emailProvider,
    });

    expect(result).not.toBeNull();
    expect(result?.relevantEmails.length).toBeGreaterThan(0);
    expect(result?.relevantEmails[0]).toContain("Proposal discussion");
  });
});
