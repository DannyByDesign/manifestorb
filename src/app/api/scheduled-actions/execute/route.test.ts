import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";
import { executeScheduledAction } from "@/features/scheduled/executor";
import { createEmailProvider } from "@/features/email/provider";

vi.mock("@/server/db/client");
vi.mock("@/env", () => ({
  env: { CRON_SECRET: "secret" },
}));
vi.mock("@/features/scheduled/executor", () => ({
  executeScheduledAction: vi.fn(),
}));
vi.mock("@/features/email/provider", () => ({
  createEmailProvider: vi.fn(),
}));

describe("POST /api/scheduled-actions/execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthorized", async () => {
    const req = new Request("http://localhost/api/scheduled-actions/execute", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
      body: JSON.stringify({ scheduledActionId: "sa-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when scheduledActionId missing", async () => {
    const req = new Request("http://localhost/api/scheduled-actions/execute", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns success false when action not found", async () => {
    prisma.scheduledAction.findUnique.mockResolvedValue(null);
    const req = new Request("http://localhost/api/scheduled-actions/execute", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify({ scheduledActionId: "sa-1" }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("returns already finished status", async () => {
    prisma.scheduledAction.findUnique.mockResolvedValue({
      id: "sa-1",
      status: "COMPLETED",
    } as any);
    const req = new Request("http://localhost/api/scheduled-actions/execute", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify({ scheduledActionId: "sa-1" }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.status).toBe("COMPLETED");
  });

  it("executes scheduled action when valid", async () => {
    prisma.scheduledAction.findUnique.mockResolvedValue({
      id: "sa-1",
      status: "PENDING",
      emailAccountId: "email-1",
    } as any);
    prisma.emailAccount.findUnique.mockResolvedValue({
      id: "email-1",
      account: { provider: "google" },
    } as any);
    vi.mocked(createEmailProvider).mockResolvedValue({} as any);
    vi.mocked(executeScheduledAction).mockResolvedValue({ success: true } as any);

    const req = new Request("http://localhost/api/scheduled-actions/execute", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify({ scheduledActionId: "sa-1" }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
