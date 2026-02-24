import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/server/lib/__mocks__/prisma";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createEmailCapabilities } from "@/server/features/ai/tools/runtime/capabilities/email";
import { Prisma } from "@/generated/prisma/client";

vi.mock("@/server/db/client");

const mockEnv = vi.hoisted(() => ({
  QSTASH_TOKEN: "test-qstash-token",
  NEXT_PUBLIC_EMAIL_SEND_ENABLED: true,
}));

vi.mock("@/env", () => ({ env: mockEnv }));

const publishJsonMock = vi.hoisted(() => vi.fn());
vi.mock("@upstash/qstash", () => ({
  Client: vi.fn().mockImplementation(() => ({
    publishJSON: publishJsonMock,
  })),
}));

vi.mock("@/server/lib/internal-api", () => ({
  getInternalApiUrl: vi.fn().mockReturnValue("https://internal.test"),
}));

vi.mock("@/server/lib/cron", () => ({
  getCronSecretHeader: vi.fn().mockReturnValue({ Authorization: "Bearer test" }),
}));

vi.mock("@/server/features/ai/tools/calendar-time", () => ({
  resolveDefaultCalendarTimeZone: vi.fn().mockResolvedValue({
    timeZone: "America/Los_Angeles",
  }),
}));

const getEmailMessagesMock = vi.hoisted(() => vi.fn());
const getEmailThreadMock = vi.hoisted(() => vi.fn());
const modifyEmailMessagesMock = vi.hoisted(() => vi.fn());
const trashEmailMessagesMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/features/ai/tools/email/primitives", () => ({
  getEmailMessages: getEmailMessagesMock,
  getEmailThread: getEmailThreadMock,
  modifyEmailMessages: modifyEmailMessagesMock,
  trashEmailMessages: trashEmailMessagesMock,
}));

function buildEnv(overrides?: {
  provider?: Partial<CapabilityEnvironment["toolContext"]["providers"]["email"]>;
  currentMessage?: string;
  conversationId?: string;
}): CapabilityEnvironment {
  const provider: CapabilityEnvironment["toolContext"]["providers"]["email"] = {
    name: "google",
    moveThreadToFolder: vi.fn().mockResolvedValue(undefined),
    ...overrides?.provider,
  } as never;

  return {
    runtime: {
      userId: "user-1",
      emailAccountId: "email-1",
      email: "user@example.com",
      provider: "web",
      currentMessage: overrides?.currentMessage,
      conversationId: overrides?.conversationId,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      } as never,
    },
    toolContext: {
      userId: "user-1",
      emailAccountId: "email-1",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      } as never,
      providers: {
        email: provider,
        calendar: {} as never,
      },
    } as never,
  };
}

describe("email mutation reliability repros", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEmailMessagesMock.mockResolvedValue([]);
    getEmailThreadMock.mockResolvedValue({
      id: "thread-1",
      messages: [{ id: "message-1", threadId: "thread-1" }],
    });
    modifyEmailMessagesMock.mockResolvedValue({ success: true, count: 1 });
    trashEmailMessagesMock.mockResolvedValue({ success: true, count: 1 });
    prisma.scheduledDraftSend.create.mockResolvedValue({
      id: "schedule-1",
      userId: "user-1",
      emailAccountId: "email-1",
      draftId: "draft-1",
      sendAt: new Date("2026-02-25T10:00:00.000Z"),
      status: "PENDING",
      idempotencyKey: "idem-1",
      sourceConversationId: null,
      scheduledId: null,
      sentAt: null,
      messageId: null,
      threadId: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    prisma.scheduledDraftSend.findUnique.mockResolvedValue(null as never);
    prisma.scheduledDraftSend.update.mockResolvedValue({} as never);
    prisma.pendingAgentTurnState.create.mockResolvedValue({
      id: "idem-row-1",
      correlationId: "idem-key-1",
      status: "PENDING",
      payload: {},
    } as never);
    prisma.pendingAgentTurnState.findUnique.mockResolvedValue(null as never);
    prisma.pendingAgentTurnState.update.mockResolvedValue({
      id: "idem-row-1",
      correlationId: "idem-key-1",
      status: "RESOLVED",
      payload: {},
    } as never);
  });

  it("repro: gmail moveThread should fail explicitly instead of reporting success", async () => {
    const caps = createEmailCapabilities(buildEnv());
    const result = await caps.moveThread({
      ids: ["thread-1"],
      folderName: "Archive-2026",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("unsupported_operation");
  });

  it("repro: partial bulk mutations should not be reported as full success", async () => {
    modifyEmailMessagesMock.mockResolvedValue({
      success: true,
      count: 1,
      succeededIds: ["message-1"],
      failedIds: ["message-2"],
      retriable: true,
    });
    const caps = createEmailCapabilities(buildEnv());
    const result = await caps.batchArchive({
      ids: ["message-1", "message-2"],
    });

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({
      failedIds: ["message-2"],
      retriable: true,
    });
  });

  it("repro: scheduleSend publish failures should mark schedule row as FAILED", async () => {
    publishJsonMock.mockRejectedValue(new Error("qstash unavailable"));
    const caps = createEmailCapabilities(buildEnv());
    const result = await caps.scheduleSend("draft-1", "2026-02-25T10:00:00");

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({
      scheduleId: "schedule-1",
      status: "FAILED",
    });
    expect(prisma.scheduledDraftSend.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "schedule-1" },
        data: expect.objectContaining({
          status: "FAILED",
        }),
      }),
    );
  });

  it("repro: duplicate sendDraft retries should replay deterministic outcome", async () => {
    const sendDraftMock = vi.fn().mockResolvedValue({
      messageId: "message-1",
      threadId: "thread-1",
    });
    const caps = createEmailCapabilities(
      buildEnv({
        currentMessage: "send the draft now",
        conversationId: "conversation-1",
        provider: {
          sendDraft: sendDraftMock,
        },
      }),
    );

    const first = await caps.sendDraft("draft-1");

    prisma.pendingAgentTurnState.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        clientVersion: "test",
        code: "P2002",
      }),
    );
    prisma.pendingAgentTurnState.findUnique.mockResolvedValueOnce({
      id: "idem-row-1",
      correlationId: "idem-key-1",
      status: "RESOLVED",
      payload: {
        toolResult: first,
      },
    } as never);

    const replay = await caps.sendDraft("draft-1");

    expect(sendDraftMock).toHaveBeenCalledTimes(1);
    expect(first.success).toBe(true);
    expect(replay.success).toBe(true);
    expect(replay.data).toMatchObject({
      idempotency: expect.objectContaining({
        replayed: true,
      }),
    });
  });
});
