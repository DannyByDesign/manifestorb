import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma, { resetPrismaMock } from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");

import { ConversationService } from "@/server/features/conversations/service";

describe("ConversationService unified links", () => {
  beforeEach(() => {
    resetPrismaMock();
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
  });

  it("links existing conversation to active unified conversation", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
      provider: "web",
      channelId: "web-primary-channel",
      threadId: "root",
      isPrimary: true,
    } as never);

    prisma.unifiedConversationLink.findUnique.mockResolvedValue(null as never);
    prisma.unifiedConversation.findFirst.mockResolvedValue({ id: "uc-1" } as never);

    const conversation = await ConversationService.ensureConversation({
      userId: "user-1",
      provider: "web",
      channelId: "web-primary-channel",
      threadId: "root",
      isPrimary: true,
    });

    expect(conversation.id).toBe("conv-1");
    expect(prisma.unifiedConversationLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unifiedConversationId: "uc-1",
          conversationId: "conv-1",
        }),
      }),
    );
  });

  it("creates unified conversation when none exists", async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: "conv-2",
      userId: "user-2",
      provider: "telegram",
      channelId: "channel-2",
      threadId: "root",
      isPrimary: false,
    } as never);

    prisma.unifiedConversationLink.findUnique.mockResolvedValue(null as never);
    prisma.unifiedConversation.findFirst.mockResolvedValue(null as never);
    prisma.unifiedConversation.create.mockResolvedValue({ id: "uc-created" } as never);

    await ConversationService.ensureConversation({
      userId: "user-2",
      provider: "telegram",
      channelId: "channel-2",
      threadId: "root",
    });

    expect(prisma.unifiedConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-2",
          status: "active",
        }),
      }),
    );
  });
});
