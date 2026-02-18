import { describe, it, expect, vi } from "vitest";

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

vi.mock("../env", () => ({ env: mockEnv }));

describe("slack sendSlackMessage", () => {
  it("does not throw when slack app not initialized", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendSlackMessage } = await import("./index");
    await expect(sendSlackMessage("channel", "hello")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith("Slack app not initialized");
    errorSpy.mockRestore();
  });
});
