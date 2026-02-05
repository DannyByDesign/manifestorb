import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  sendFiledNotification,
  sendAskNotification,
} from "@/server/features/drive/filing-notifications";
import prisma from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  with: vi.fn().mockReturnThis(),
} as any;

describe("filing notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns when filing not found", async () => {
    prisma.documentFiling.findUnique.mockResolvedValue(null);
    await sendFiledNotification({
      emailProvider: { sendEmailWithHtml: vi.fn() } as any,
      userEmail: "user@test.com",
      filingId: "filing-1",
      sourceMessage: {
        threadId: "thread-1",
        headerMessageId: "msg-1",
      },
      logger,
    });
    expect(prisma.documentFiling.update).not.toHaveBeenCalled();
  });

  it("sends ask notification and stores message id", async () => {
    prisma.documentFiling.findUnique.mockResolvedValue({
      id: "filing-1",
      filename: "file.pdf",
      reasoning: "reason",
    } as any);
    const sendEmailWithHtml = vi
      .fn()
      .mockResolvedValue({ messageId: "msg-123" });

    await sendAskNotification({
      emailProvider: { sendEmailWithHtml } as any,
      userEmail: "user@test.com",
      filingId: "filing-1",
      sourceMessage: {
        threadId: "thread-1",
        headerMessageId: "msg-1",
      },
      logger,
    });

    expect(prisma.documentFiling.update).toHaveBeenCalledWith({
      where: { id: "filing-1" },
      data: {
        notificationMessageId: "msg-123",
        notificationSentAt: expect.any(Date),
      },
    });
  });
});
