import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const mockCreateRequest = vi.hoisted(() => vi.fn());

vi.mock("@/features/approvals/service", () => ({
  ApprovalService: class {
    createRequest = (...args: unknown[]) => mockCreateRequest(...args);
  },
}));

vi.mock("@/server/db/client");
vi.mock("@/env", () => ({
  env: {
    SURFACES_SHARED_SECRET: "secret",
  },
}));

const validBody = {
  userId: "user-1",
  provider: "slack",
  externalContext: { channelId: "c-1" },
  requestPayload: {
    actionType: "tool",
    description: "desc",
    args: { foo: "bar" },
  },
  idempotencyKey: "idem-1",
};

describe("POST /api/approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when secret mismatch", async () => {
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify(validBody),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid body", async () => {
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify({ userId: "user-1" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("creates approval request", async () => {
    mockCreateRequest.mockResolvedValue({ id: "req-1" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      headers: { "x-surfaces-secret": "secret" },
      body: JSON.stringify(validBody),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ id: "req-1" });
    expect(mockCreateRequest).toHaveBeenCalledWith(validBody);
  });
});
