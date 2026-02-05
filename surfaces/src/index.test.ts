import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./db/redis", () => ({
  redis: null,
}));
vi.mock("./db/prisma", () => ({
  prisma: { $queryRaw: vi.fn() },
}));
vi.mock("./slack", () => ({
  sendSlackMessage: vi.fn(),
}));
vi.mock("./discord", () => ({
  sendDiscordMessage: vi.fn(),
}));

const setEnv = () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/amodel";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.OPENAI_API_KEY = "test-openai";
  process.env.GOOGLE_API_KEY = "test-google";
  process.env.JOBS_SHARED_SECRET = "jobs-secret";
  process.env.SURFACES_SHARED_SECRET = "secret";
  process.env.INTERNAL_API_KEY = "internal";
};

describe("surfaces handleRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnv();
  });

  it("returns 401 for unauthorized notify", async () => {
    const { handleRequest } = await import("./index");
    const res = await handleRequest(
      new Request("http://localhost/notify", {
        method: "POST",
        body: JSON.stringify({ platform: "slack", channelId: "c1", content: "hi" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing notify fields", async () => {
    const { handleRequest } = await import("./index");
    const res = await handleRequest(
      new Request("http://localhost/notify", {
        method: "POST",
        headers: { Authorization: "Bearer secret" },
        body: JSON.stringify({ platform: "slack" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("sends slack notification", async () => {
    const { handleRequest } = await import("./index");
    const { sendSlackMessage } = await import("./slack");

    const res = await handleRequest(
      new Request("http://localhost/notify", {
        method: "POST",
        headers: { Authorization: "Bearer secret" },
        body: JSON.stringify({
          platform: "slack",
          channelId: "c1",
          content: "hi",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(sendSlackMessage).toHaveBeenCalledWith("c1", "hi");
  });
});
