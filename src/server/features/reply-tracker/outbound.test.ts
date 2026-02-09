import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleOutboundReply } from "./outbound";
import prisma from "@/server/lib/__mocks__/prisma";
import { aiDetermineThreadStatus } from "@/features/reply-tracker/ai/determine-thread-status";
import { applyThreadStatusLabel } from "./label-helpers";
import { updateThreadTrackers } from "@/features/reply-tracker/handle-conversation-status";
import { getEmailAccount, getMockMessage } from "@/tests/support/helpers";
import { createScopedLogger } from "@/server/lib/logger";
import { SystemType } from "@/generated/prisma/enums";

vi.mock("@/server/db/client");
vi.mock("@/features/reply-tracker/ai/determine-thread-status");
vi.mock("./label-helpers");
vi.mock("@/features/reply-tracker/handle-conversation-status");
vi.mock("server-only", () => ({}));

describe("handleOutboundReply", () => {
  const logger = createScopedLogger("test");
  const emailAccount = getEmailAccount();
  const provider = {
    getThreadMessages: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should proceed with processing even if the message is not the latest in the thread", async () => {
    const message = getMockMessage({ id: "sent-msg-1", threadId: "thread1" });
    const latestMessage = getMockMessage({
      id: "newer-msg-2",
      threadId: "thread1",
    });

    // Mock tracking enabled
    prisma.rule.findFirst.mockResolvedValue({ id: "rule1" } as any);

    // Mock thread messages - sortByInternalDate sorts asc by default (oldest first)
    // We mock getThreadMessages to return messages that our internal sortByInternalDate will sort
    provider.getThreadMessages.mockResolvedValue([message, latestMessage]);

    // Mock AI status
    vi.mocked(aiDetermineThreadStatus).mockResolvedValue({
      status: SystemType.AWAITING_REPLY,
      rationale: "Waiting for response",
    });

    await handleOutboundReply({
      emailAccount,
      message: message as any,
      provider: provider as any,
      logger,
    });

    // Verify it didn't return early
    expect(aiDetermineThreadStatus).toHaveBeenCalled();
    expect(applyThreadStatusLabel).toHaveBeenCalledWith(
      expect.objectContaining({
        systemType: SystemType.AWAITING_REPLY,
      }),
    );
    expect(updateThreadTrackers).toHaveBeenCalled();
  });

  it("should return early if outbound tracking is disabled", async () => {
    const message = getMockMessage({ id: "sent-msg-1", threadId: "thread1" });

    // Mock tracking disabled
    prisma.rule.findFirst.mockResolvedValue(null);

    await handleOutboundReply({
      emailAccount,
      message: message as any,
      provider: provider as any,
      logger,
    });

    expect(provider.getThreadMessages).not.toHaveBeenCalled();
    expect(aiDetermineThreadStatus).not.toHaveBeenCalled();
  });
});
