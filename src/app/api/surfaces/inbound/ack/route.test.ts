import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const redisSetMock = vi.fn();

vi.mock("@/server/lib/redis", () => ({
  redis: {
    set: redisSetMock,
  },
}));

vi.mock("@/env", () => ({
  env: {
    SURFACES_SHARED_SECRET: "secret",
    REDIS_URL: "redis://localhost:6379",
  },
}));

describe("POST /api/surfaces/inbound/ack", () => {
  beforeEach(() => {
    redisSetMock.mockReset();
    redisSetMock.mockResolvedValue("OK");
  });

  it("returns 401 when unauthorized", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/inbound/ack", {
      method: "POST",
      body: JSON.stringify({ responseId: "resp-1" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid payload", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/inbound/ack", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("records ack in redis", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/surfaces/inbound/ack", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify({
        responseId: "resp-1",
        provider: "slack",
        providerMessageId: "123.456",
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(redisSetMock).toHaveBeenCalledTimes(1);
    expect(redisSetMock.mock.calls[0]?.[0]).toBe("surfaces:delivery:ack:resp-1");
  });
});
