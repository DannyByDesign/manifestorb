import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma, { resetPrismaMock } from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");
vi.mock("@/server/lib/user-utils", () => ({
  resolveEmailAccount: vi.fn(
    (
      user: { emailAccounts: Array<{ id: string; updatedAt?: Date }> },
      preferredEmailAccountId?: string | null,
      options?: { allowImplicit?: boolean },
    ) => {
      if (preferredEmailAccountId) {
        const explicit = user.emailAccounts.find((account) => account.id === preferredEmailAccountId);
        if (explicit) return explicit;
      }
      if (user.emailAccounts.length === 1) return user.emailAccounts[0];
      if (options?.allowImplicit === false) return null;
      return user.emailAccounts[0];
    },
  ),
  resolveEmailAccountFromMessageHint: vi.fn(() => null),
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
vi.mock("@/server/lib/linking", () => ({
  createLinkToken: vi.fn().mockResolvedValue("token-1"),
}));
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_BASE_URL: "https://example.test",
    NODE_ENV: "test",
  },
}));

function createLinkedAccount(overrides?: {
  emailAccounts?: Array<{ id: string; email: string; account: { disconnectedAt: Date | null } }>;
}) {
  return {
    user: {
      id: "user-1",
      emailAccounts: overrides?.emailAccounts ?? [
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
    async (args) =>
      ({
        id: "conv-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        isPrimary: false,
        relatedEmailThreadId: null,
        relatedCalendarEventId: null,
        ...(args?.data ?? {}),
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

  it("uses exact conversation key lookup and forwards surfaces history", async () => {
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

    const providerOnlyLookup = prisma.conversation.findFirst.mock.calls.some(
      (call) => {
        const arg = call[0] as { where?: Record<string, unknown> } | undefined;
        const where = arg?.where ?? {};
        return (
          where.userId === "user-1" &&
          where.provider === "slack" &&
          !Object.prototype.hasOwnProperty.call(where, "channelId")
        );
      },
    );
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

  it("resolves Slack account by workspace-qualified providerAccountId before raw fallback", async () => {
    prisma.account.findUnique.mockResolvedValueOnce(createLinkedAccount());

    const { ChannelRouter } = await import("./router");
    const router = new ChannelRouter();

    await router.handleInbound({
      provider: "slack",
      content: "hello",
      context: {
        channelId: "C123",
        userId: "U123",
        workspaceId: "T123",
        messageId: "222.333",
        isDirectMessage: true,
      },
    });

    expect(prisma.account.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_providerAccountId: {
            provider: "slack",
            providerAccountId: "T123:U123",
          },
        },
      }),
    );
  });

  it("keeps unlinked Slack prompt in-thread and uses workspace-qualified link token id", async () => {
    prisma.account.findUnique.mockResolvedValue(null);
    prisma.account.findMany.mockResolvedValue([]);

    const { createLinkToken } = await import("@/server/lib/linking");
    const { ChannelRouter } = await import("./router");
    const router = new ChannelRouter();

    const response = await router.handleInbound({
      provider: "slack",
      content: "hello",
      context: {
        channelId: "C123",
        userId: "U123",
        workspaceId: "T123",
        messageId: "111.222",
        isDirectMessage: true,
      },
    });

    expect(createLinkToken).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "slack",
        providerAccountId: "T123:U123",
        providerTeamId: "T123",
      }),
    );
    expect(response[0]?.targetThreadId).toBe("111.222");
    expect(response[0]?.content).toContain("Link Your Account");
  });

  it("requires account clarification for ambiguous multi-account inbox/calendar actions", async () => {
    prisma.account.findUnique.mockResolvedValue(
      createLinkedAccount({
        emailAccounts: [
          {
            id: "email-1",
            email: "work@example.com",
            account: { disconnectedAt: null },
          },
          {
            id: "email-2",
            email: "home@example.com",
            account: { disconnectedAt: null },
          },
        ],
      }),
    );
    prisma.conversation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const { runOneShotAgent } = await import("@/features/channels/executor");
    const { ChannelRouter } = await import("./router");
    const router = new ChannelRouter();
    const beforeCalls = vi.mocked(runOneShotAgent).mock.calls.length;

    const response = await router.handleInbound({
      provider: "slack",
      content: "archive emails from today",
      context: {
        channelId: "C123",
        userId: "U123",
        messageId: "111.222",
        isDirectMessage: true,
      },
    });

    expect(vi.mocked(runOneShotAgent).mock.calls.length).toBe(beforeCalls);
    expect(response[0]?.content).toContain("multiple connected accounts");
    expect(response[0]?.content).toContain("work@example.com");
    expect(response[0]?.content).toContain("home@example.com");
  });
});
