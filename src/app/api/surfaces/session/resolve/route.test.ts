import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import prisma, { resetPrismaMock } from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");
vi.mock("@/env", () => ({
  env: {
    SURFACES_SHARED_SECRET: "secret",
  },
}));

describe("POST /api/surfaces/session/resolve", () => {
  beforeEach(() => {
    resetPrismaMock();
  });

  it("returns 401 when unauthorized", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/session/resolve", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns unlinked status when account is missing", async () => {
    prisma.account.findUnique.mockResolvedValue(null);
    prisma.account.findMany.mockResolvedValue([]);

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/session/resolve", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify({
        provider: "discord",
        providerAccountId: "U123",
        channelId: "C123",
        messageId: "m-1",
      }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      linked: false,
      status: "unlinked",
      canonicalThreadId: "root",
    });
  });

  it("returns linked session with canonical thread", async () => {
    prisma.account.findUnique.mockResolvedValue({ userId: "user-1" } as never);
    prisma.conversation.findFirst.mockResolvedValueOnce({
      id: "conv-1",
      channelId: "C123",
      threadId: "111.222",
    } as never);

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/session/resolve", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify({
        provider: "slack",
        providerAccountId: "U123",
        channelId: "C123",
        messageId: "111.222",
      }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      linked: true,
      status: "linked",
      canonicalThreadId: "111.222",
      conversationId: "conv-1",
    });
  });
});
