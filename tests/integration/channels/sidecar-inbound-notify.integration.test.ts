import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

class MockChannelRouter {
  handleInbound = vi.fn().mockResolvedValue([{ content: "ok" }]);
}

vi.mock("@/features/channels/router", () => ({
  ChannelRouter: MockChannelRouter,
}));
vi.mock("../../../surfaces/src/db/redis", () => ({
  redis: null,
}));
vi.mock("../../../surfaces/src/db/prisma", () => ({
  prisma: { $queryRaw: vi.fn() },
}));
vi.mock("../../../surfaces/src/slack", () => ({
  sendSlackMessage: vi.fn(),
}));
vi.mock("../../../surfaces/src/discord", () => ({
  sendDiscordMessage: vi.fn(),
}));

const setSidecarEnv = () => {
  (process.env as any).NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/amodel";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.OPENAI_API_KEY = "test-openai";
  process.env.GOOGLE_API_KEY = "test-google";
  process.env.JOBS_SHARED_SECRET = "jobs-secret";
  process.env.SURFACES_SHARED_SECRET = "secret";
  process.env.INTERNAL_API_KEY = "internal";
};

describe("E2E sidecar inbound + notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SURFACES_SHARED_SECRET = "secret";
    setSidecarEnv();
  });

  it("routes inbound then sends notify", async () => {
    const { POST: inboundPost } = await import(
      "@/app/api/surfaces/inbound/route"
    );
    const inboundReq = new NextRequest("http://localhost/api/surfaces/inbound", {
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

    const inboundRes = await inboundPost(inboundReq);
    const inboundJson = await inboundRes.json();
    expect(inboundJson.responses).toHaveLength(1);

    const { handleRequest } = await import("../../../surfaces/src/index");
    const notifyRes = await handleRequest(
      new Request("http://localhost/notify", {
        method: "POST",
        headers: { Authorization: "Bearer secret" },
        body: JSON.stringify({
          platform: "slack",
          channelId: "c1",
          content: "ok",
        }),
      }),
    );
    expect(notifyRes.status).toBe(200);
  }, 20_000);

  it("rejects notify requests with missing content", async () => {
    const { handleRequest } = await import("../../../surfaces/src/index");
    const notifyRes = await handleRequest(
      new Request("http://localhost/notify", {
        method: "POST",
        headers: { Authorization: "Bearer secret" },
        body: JSON.stringify({
          platform: "slack",
          channelId: "c1",
        }),
      }),
    );
    expect(notifyRes.status).toBe(400);
  });
});
