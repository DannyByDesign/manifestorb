import { describe, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/amodel",
  REDIS_URL: "redis://localhost:6379",
  OPENAI_API_KEY: "test-openai",
  GOOGLE_API_KEY: "test-google",
  JOBS_SHARED_SECRET: "jobs-secret",
  SURFACES_SHARED_SECRET: "secret",
  INTERNAL_API_KEY: "internal",
  BRAIN_API_URL: "http://localhost:3000/api/surfaces/inbound",
  CORE_BASE_URL: "http://localhost:3000",
}));

vi.mock("../../env", () => ({ env: mockEnv }));

describe("telegram startTelegram", () => {
  it("returns when token missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const { startTelegram } = await import("./index");
    startTelegram();
  });
});
