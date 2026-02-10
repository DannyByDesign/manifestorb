import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma, { resetPrismaMock } from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");
vi.mock("@/server/lib/user-utils", () => ({
  resolveEmailAccount: vi.fn((user: { emailAccounts: unknown[] }) => user.emailAccounts[0]),
}));
vi.mock("@/features/privacy/service", () => ({
  PrivacyService: {
    shouldRecord: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock("@/features/memory/service", () => ({
  MemoryRecordingService: {
    shouldRecord: vi.fn().mockResolvedValue(false),
    enqueueMemoryRecording: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/features/channels/executor", () => ({
  runOneShotAgent: vi.fn().mockResolvedValue({
    text: "ok",
    approvals: [],
    interactivePayloads: [],
  }),
}));

function createLinkedAccount() {
  return {
    user: {
      id: "user-1",
      emailAccounts: [
        {
          id: "email-1",
          email: "user@example.com",
          account: { disconnectedAt: null },
        },
      ],
    },
  } as never;
}

function mockConversationCreate() {
  prisma.conversation.create.mockImplementation(
    async ({ data }: { data: { userId: string; provider: string; channelId: string; threadId: string } }) =>
      ({
        id: "conv-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        isPrimary: false,
        relatedEmailThreadId: null,
        relatedCalendarEventId: null,
        ...data,
      }) as never,
  );
}

describe("ChannelRouter", () => {
  beforeEach(() => {
    resetPrismaMock();
    prisma.account.findUnique.mockResolvedValue(createLinkedAccount());
    mockConversationCreate();
    prisma.conversationMessage.upsert.mockResolvedValue({ id: "cm-1" } as never);
  });

  it("uses exact conversation key lookup and forwards sidecar history", async () => {
    prisma.conversation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const { runOneShotAgent } = await import("@/features/channels/executor");
    const { ChannelRouter } = await import("./router");

    const router = new ChannelRouter();
    const response = await router.handleInbound({
      provider: "slack",
      content: "hello",
      context: {
        channelId: "C123",
        userId: "U123",
        messageId: "111.222",
        isDirectMessage: true,
      },
      history: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
      ],
    });

    expect(response[0]?.targetThreadId).toBe("111.222");
    expect(prisma.conversation.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        userId: "user-1",
        provider: "slack",
        channelId: "C123",
        threadId: "111.222",
      },
    });

    const providerOnlyLookup = prisma.conversation.findFirst.mock.calls.some(([arg]) => {
      const where = (arg as { where?: Record<string, unknown> })?.where ?? {};
      return (
        where.userId === "user-1" &&
        where.provider === "slack" &&
        !Object.prototype.hasOwnProperty.call(where, "channelId")
      );
    });
    expect(providerOnlyLookup).toBe(false);

    expect(runOneShotAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        history: [
          { role: "user", content: "first" },
          { role: "assistant", content: "second" },
        ],
        context: expect.objectContaining({
          threadId: "111.222",
        }),
      }),
    );
  });

  it("uses root thread for threadless providers and omits outbound thread target", async () => {
    prisma.conversation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const { runOneShotAgent } = await import("@/features/channels/executor");
    const { ChannelRouter } = await import("./router");

    const router = new ChannelRouter();
    const response = await router.handleInbound({
      provider: "discord",
      content: "ping",
      context: {
        channelId: "D1",
        userId: "U1",
        messageId: "msg-1",
        isDirectMessage: true,
      },
    });

    expect(prisma.conversation.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        userId: "user-1",
        provider: "discord",
        channelId: "D1",
        threadId: "root",
      },
    });
    expect(response[0]?.targetThreadId).toBeUndefined();
    expect(runOneShotAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          threadId: "root",
        }),
      }),
    );
  });
});
