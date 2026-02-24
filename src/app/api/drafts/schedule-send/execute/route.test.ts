import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";
import { createEmailProvider } from "@/features/email/provider";
import { sendDraftById } from "@/features/drafts/operations";

vi.mock("@/server/db/client");
vi.mock("@/env", () => ({
  env: { CRON_SECRET: "secret" },
}));
vi.mock("@/server/lib/qstash", () => ({
  withQStashSignatureAppRouter: (handler: (req: Request) => Promise<Response>) => handler,
}));
vi.mock("@/features/email/provider", () => ({
  createEmailProvider: vi.fn(),
}));
vi.mock("@/features/drafts/operations", () => ({
  sendDraftById: vi.fn(),
}));

describe("POST /api/drafts/schedule-send/execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthorized", async () => {
    const req = new Request("http://localhost/api/drafts/schedule-send/execute", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
      body: JSON.stringify({
        scheduleId: "schedule-1",
        emailAccountId: "email-1",
        draftId: "draft-1",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("dedupes when schedule was already sent by another worker", async () => {
    prisma.scheduledDraftSend.findUnique
      .mockResolvedValueOnce({
        id: "schedule-1",
        emailAccountId: "email-1",
        draftId: "draft-1",
        status: "PENDING",
      } as never)
      .mockResolvedValueOnce({
        status: "SENT",
        messageId: "msg-1",
        threadId: "thread-1",
        sentAt: new Date("2026-02-24T08:00:00.000Z"),
      } as never);
    prisma.scheduledDraftSend.updateMany.mockResolvedValueOnce({ count: 0 } as never);

    const req = new Request("http://localhost/api/drafts/schedule-send/execute", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify({
        scheduleId: "schedule-1",
        emailAccountId: "email-1",
        draftId: "draft-1",
      }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      deduped: true,
      scheduleId: "schedule-1",
      status: "SENT",
      messageId: "msg-1",
      threadId: "thread-1",
    });
  });

  it("locks by scheduleId and marks schedule as sent on success", async () => {
    prisma.scheduledDraftSend.findUnique.mockResolvedValueOnce({
      id: "schedule-1",
      emailAccountId: "email-1",
      draftId: "draft-1",
      status: "PENDING",
    } as never);
    prisma.scheduledDraftSend.updateMany.mockResolvedValueOnce({ count: 1 } as never);
    prisma.emailAccount.findUnique.mockResolvedValueOnce({
      id: "email-1",
      account: { provider: "google" },
    } as never);
    vi.mocked(createEmailProvider).mockResolvedValue({} as never);
    vi.mocked(sendDraftById).mockResolvedValue({
      messageId: "msg-1",
      threadId: "thread-1",
    } as never);

    const req = new Request("http://localhost/api/drafts/schedule-send/execute", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify({
        scheduleId: "schedule-1",
        emailAccountId: "email-1",
        draftId: "draft-1",
      }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.scheduleId).toBe("schedule-1");
    expect(prisma.scheduledDraftSend.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "schedule-1" },
        data: expect.objectContaining({
          status: "SENT",
          messageId: "msg-1",
          threadId: "thread-1",
        }),
      }),
    );
  });
});
