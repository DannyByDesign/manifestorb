import { beforeEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

const handleInboundMock = vi.fn().mockResolvedValue([{ content: "ok" }]);
const redisGetMock = vi.fn();
const redisSetMock = vi.fn();

class MockChannelRouter {
  handleInbound = handleInboundMock;
}

vi.mock("@/features/channels/router", () => ({
  ChannelRouter: MockChannelRouter,
}));
vi.mock("@/server/lib/redis", () => ({
  redis: {
    get: redisGetMock,
    set: redisSetMock,
  },
}));
vi.mock("@/env", () => ({
  env: {
    SURFACES_SHARED_SECRET: "secret",
    UPSTASH_REDIS_URL: "https://redis.example",
    UPSTASH_REDIS_TOKEN: "token",
  },
}));

describe("POST /api/surfaces/inbound", () => {
  beforeEach(() => {
    handleInboundMock.mockReset();
    handleInboundMock.mockResolvedValue([{ content: "ok" }]);
    redisGetMock.mockReset();
    redisSetMock.mockReset();
    redisGetMock.mockResolvedValue(null);
    redisSetMock.mockResolvedValue("OK");
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
    expect(json.responses).toHaveLength(1);
    expect(json.responses[0]).toMatchObject({
      targetChannelId: "c1",
      targetThreadId: "t1",
      content: "I hit an unexpected issue generating a reply. Please try again in a moment.",
    });
    expect(typeof json.responses[0].responseId).toBe("string");
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
    expect(redisSetMock).toHaveBeenCalledTimes(1);
  });

  it("returns cached response when idempotency key was seen", async () => {
    redisGetMock.mockResolvedValueOnce(
      JSON.stringify({
        responses: [
          {
            responseId: "resp-cached",
            targetChannelId: "c1",
            content: "cached",
          },
        ],
      }),
    );
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/inbound", {
      method: "POST",
      headers: {
        "x-surfaces-secret": "secret",
        "idempotency-key": "idem-123",
      },
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
    expect(json.responses[0].responseId).toBe("resp-cached");
    expect(handleInboundMock).not.toHaveBeenCalled();
  });
});
