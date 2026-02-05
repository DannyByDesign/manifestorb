import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";
import { auth } from "@/server/auth";
import { verifyApprovalActionToken } from "@/features/approvals/action-token";

vi.mock("@/server/db/client");
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));
vi.mock("@/features/approvals/action-token", () => ({
  verifyApprovalActionToken: vi.fn(),
}));
class MockChannelRouter {
  pushMessage = vi.fn().mockResolvedValue(undefined);
}

vi.mock("@/features/channels/router", () => ({
  ChannelRouter: MockChannelRouter,
}));
vi.mock("@/server/lib/llms", () => ({
  createGenerateText: vi.fn().mockReturnValue(async () => ({ text: "Ok." })),
}));
vi.mock("@/server/lib/llms/model", () => ({
  getModel: vi.fn().mockReturnValue({ model: "mock" }),
}));

const mockAuth = vi.mocked(auth);
const mockVerify = vi.mocked(verifyApprovalActionToken);

describe("POST /api/approvals/[id]/deny", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.approvalRequest.findUnique.mockResolvedValue({
      userId: "user-1",
      user: { emailAccounts: [{ id: "email-1", account: { provider: "google" } }] },
      requestPayload: { tool: "reply" },
    } as any);
  });

  it("returns 401 when no session or token", async () => {
    mockAuth.mockResolvedValue(null as any);
    const req = new NextRequest("http://localhost/api/approvals/req-1/deny", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "req-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when token action mismatches", async () => {
    mockAuth.mockResolvedValue(null as any);
    mockVerify.mockReturnValue({ action: "approve", approvalId: "req-1" } as any);

    const req = new NextRequest(
      "http://localhost/api/approvals/req-1/deny?token=tok",
      { method: "POST", body: JSON.stringify({}) },
    );

    const res = await POST(req, { params: Promise.resolve({ id: "req-1" }) });
    expect(res.status).toBe(403);
  });

  it("denies with session auth", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as any);
    prisma.approvalRequest.findUnique
      .mockResolvedValueOnce({ userId: "user-1" } as any)
      .mockResolvedValueOnce({
        id: "req-1",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 60_000),
      } as any)
      .mockResolvedValueOnce({
        userId: "user-1",
        user: {
          emailAccounts: [{ id: "email-1", account: { provider: "google" } }],
        },
        requestPayload: { tool: "reply" },
      } as any);
    prisma.approvalDecision.create.mockResolvedValue({
      id: "dec-1",
      decision: "DENY",
    } as any);
    prisma.$transaction.mockImplementation(
      async (callback: (tx: any) => unknown) =>
        callback(prisma as any),
    );

    const req = new NextRequest("http://localhost/api/approvals/req-1/deny", {
      method: "POST",
      body: JSON.stringify({ reason: "nope" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "req-1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(expect.objectContaining({ decision: "DENY" }));
  });

  it("returns 403 when session user mismatches", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-2" } } as any);

    const req = new NextRequest("http://localhost/api/approvals/req-1/deny", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "req-1" }) });
    expect(res.status).toBe(403);
  });
});
