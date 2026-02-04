/** biome-ignore-all lint/style/noMagicNumbers: test */
import { describe, expect, test, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    CRON_SECRET: "secret",
  },
}));

vi.mock("@/features/scheduled/executor", () => ({
  executeScheduledAction: vi.fn(),
}));

vi.mock("@/features/email/provider", () => ({
  createEmailProvider: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  default: {
    scheduledAction: { findUnique: vi.fn() },
    emailAccount: { findUnique: vi.fn() },
  },
}));

describe("scheduled actions auth", () => {
  test("rejects missing cron secret", async () => {
    const { POST } = await import(
      "@/app/api/scheduled-actions/execute/route"
    );

    const request = new Request("http://localhost/api/scheduled-actions/execute", {
      method: "POST",
      body: JSON.stringify({ scheduledActionId: "action-1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });
});
