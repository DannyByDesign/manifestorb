import { describe, it, expect, vi, beforeEach } from "vitest";
import { processHistoryItem } from "@/features/webhooks/process-history-item";
import {
  createMockEmailProvider,
  getMockParsedMessage,
  ErrorProviders,
} from "@/tests/support/mocks/email-provider.mock";
import { getEmailAccount } from "@/tests/support/helpers";
import { createScopedLogger } from "@/server/lib/logger";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({
  default: {
    executedRule: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    newsletter: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

const logger = createScopedLogger("test");

describe("processHistoryItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function getDefaultEmailAccount() {
    return {
      ...getEmailAccount(),
      autoCategorizeSenders: false,
      email: "test@test.com",
    };
  }

  const baseOptions = {
    hasAutomationRules: false,
    hasAiAccess: false,
    emailAccount: getDefaultEmailAccount(),
    logger,
  };

  it("handles Gmail not-found error gracefully", async () => {
    const provider = ErrorProviders.gmailNotFound();

    await expect(
      processHistoryItem(
        { messageId: "deleted-msg", threadId: "thread-123" },
        { ...baseOptions, provider },
      ),
    ).resolves.toBeUndefined();
  });

  it("throws on provider rate-limit errors", async () => {
    const provider = ErrorProviders.gmailRateLimit();

    await expect(
      processHistoryItem(
        { messageId: "msg-123", threadId: "thread-123" },
        { ...baseOptions, provider },
      ),
    ).rejects.toThrow("Rate limit exceeded");
  });

  it("processes inbound message fetch path", async () => {
    const provider = createMockEmailProvider({
      getMessage: vi.fn().mockResolvedValue(
        getMockParsedMessage({
          labelIds: ["INBOX"],
        }),
      ),
      isSentMessage: vi.fn().mockReturnValue(false),
    });

    await processHistoryItem(
      { messageId: "msg-123", threadId: "thread-123" },
      { ...baseOptions, provider },
    );

    expect(provider.getMessage).toHaveBeenCalledWith("msg-123");
  });

  it("skips outbound messages without throwing", async () => {
    const provider = createMockEmailProvider({
      getMessage: vi.fn().mockResolvedValue(
        getMockParsedMessage({
          labelIds: ["SENT"],
          headers: {
            from: "user@test.com",
            to: "recipient@example.com",
            subject: "Test",
            date: "2024-01-01",
          },
        }),
      ),
      isSentMessage: vi.fn().mockReturnValue(true),
    });

    await expect(
      processHistoryItem(
        { messageId: "msg-123", threadId: "thread-123" },
        { ...baseOptions, provider },
      ),
    ).resolves.toBeUndefined();
  });

  it("uses pre-fetched message when provided", async () => {
    const preFetchedMessage = getMockParsedMessage({
      id: "pre-fetched-msg",
      labelIds: ["INBOX"],
    });

    const provider = createMockEmailProvider({
      getMessage: vi.fn(),
      isSentMessage: vi.fn().mockReturnValue(false),
    });

    await processHistoryItem(
      {
        messageId: "pre-fetched-msg",
        threadId: "thread-123",
        message: preFetchedMessage,
      },
      { ...baseOptions, provider },
    );

    expect(provider.getMessage).not.toHaveBeenCalled();
  });
});
