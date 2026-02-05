import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "./route";
import { processHistoryForUser } from "@/app/api/google/webhook/process-history";
import { handleWebhookError } from "@/features/webhooks/error-handler";
import { getWebhookEmailAccount } from "@/features/webhooks/validate-webhook-account";

vi.mock("@/server/lib/middleware", () => ({
  withError: (_scope: string, handler: any) => handler,
}));
vi.mock("@/env", () => ({
  env: { GOOGLE_PUBSUB_VERIFICATION_TOKEN: "token" },
}));
vi.mock("@/app/api/google/webhook/process-history", () => ({
  processHistoryForUser: vi.fn(),
}));
vi.mock("@/features/webhooks/error-handler", () => ({
  handleWebhookError: vi.fn(),
}));
vi.mock("@/features/webhooks/validate-webhook-account", () => ({
  getWebhookEmailAccount: vi.fn(),
}));

describe("POST /api/google/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 on invalid token", async () => {
    const req = new Request("http://localhost/api/google/webhook?token=bad", {
      method: "POST",
      body: JSON.stringify({}),
    });

    (req as any).logger = {
      error: vi.fn(),
      info: vi.fn(),
      with: vi.fn().mockReturnThis(),
    };
    const res = await POST(req as any);
    expect(res.status).toBe(403);
  });

  it("processes webhook and returns ok", async () => {
    const payload = Buffer.from(
      JSON.stringify({ emailAddress: "user@test.com", historyId: 123 }),
    ).toString("base64");
    const req = new Request("http://localhost/api/google/webhook?token=token", {
      method: "POST",
      body: JSON.stringify({ message: { data: payload } }),
    });

    (req as any).logger = {
      error: vi.fn(),
      info: vi.fn(),
      with: vi.fn().mockReturnThis(),
    };
    const res = await POST(req as any);
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(processHistoryForUser).toHaveBeenCalled();
    expect(handleWebhookError).not.toHaveBeenCalled();
    expect(getWebhookEmailAccount).not.toHaveBeenCalled();
  });
});
