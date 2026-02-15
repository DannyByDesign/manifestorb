import { beforeEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

const handleInboundMock = vi.fn().mockResolvedValue([{ content: "ok" }]);

class MockChannelRouter {
  handleInbound = handleInboundMock;
}

vi.mock("@/features/channels/router", () => ({
  ChannelRouter: MockChannelRouter,
}));
vi.mock("@/env", () => ({
  env: {
    SURFACES_SHARED_SECRET: "secret",
  },
}));

describe("POST /api/surfaces/inbound", () => {
  beforeEach(() => {
    handleInboundMock.mockReset();
    handleInboundMock.mockResolvedValue([{ content: "ok" }]);
  });

  it("returns fallback response when router yields no outbound messages", async () => {
    handleInboundMock.mockResolvedValueOnce([]);
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/inbound", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify({
        provider: "slack",
        content: "hello",
        context: {
          channelId: "c1",
          userId: "u1",
          messageId: "m1",
          threadId: "t1",
          isDirectMessage: true,
        },
      }),
    });

    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.responses).toEqual([
      {
        targetChannelId: "c1",
        targetThreadId: "t1",
        content: "I hit an unexpected issue generating a reply. Please try again in a moment.",
      },
    ]);
  });

  it("returns 401 when unauthorized", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/inbound", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid body", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/inbound", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify({ provider: "slack" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("routes inbound message", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/inbound", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify({
        provider: "slack",
        content: "hello",
        context: {
          channelId: "c1",
          userId: "u1",
          messageId: "m1",
          isDirectMessage: true,
        },
      }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.responses).toHaveLength(1);
  });
});
