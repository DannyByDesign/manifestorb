import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

class MockChannelRouter {
  handleInbound = vi.fn().mockResolvedValue([{ content: "ok" }]);
}

vi.mock("@/features/channels/router", () => ({
  ChannelRouter: MockChannelRouter,
}));

describe("POST /api/surfaces/inbound", () => {
  beforeEach(() => {
    process.env.SURFACES_SHARED_SECRET = "secret";
  });

  afterEach(() => {
    delete process.env.SURFACES_SHARED_SECRET;
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
