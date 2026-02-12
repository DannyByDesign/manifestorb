import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";
import { auth } from "@/server/auth";
import { verifyApprovalActionToken } from "@/features/approvals/action-token";
import { executeApprovalRequest } from "@/features/approvals/execute";

vi.mock("@/server/db/client");
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));
vi.mock("@/features/approvals/action-token", () => ({
  verifyApprovalActionToken: vi.fn(),
}));
vi.mock("@/features/approvals/execute", () => ({
  executeApprovalRequest: vi.fn(),
}));
vi.mock("@/env", () => ({
  env: {
    SURFACES_SHARED_SECRET: "surfaces-secret",
  },
}));
class MockChannelRouter {
  pushMessage = vi.fn().mockResolvedValue(undefined);
}

vi.mock("@/features/channels/router", () => ({
  ChannelRouter: MockChannelRouter,
}));
vi.mock("@/server/lib/llms", () => ({
  createGenerateText: vi.fn().mockReturnValue(async () => ({ text: "Done." })),
}));
vi.mock("@/server/lib/llms/model", () => ({
  getModel: vi.fn().mockReturnValue({ model: "mock" }),
}));

const mockAuth = vi.mocked(auth);
const mockVerify = vi.mocked(verifyApprovalActionToken);
const mockExecute = vi.mocked(executeApprovalRequest);

describe("POST /api/approvals/[id]/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.approvalRequest.findUnique.mockResolvedValue({
      userId: "user-1",
    } as any);
  });

  it("returns 401 when no session or token", async () => {
    mockAuth.mockResolvedValue(null as any);
    const req = new NextRequest("http://localhost/api/approvals/req-1/approve", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "req-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when token action mismatches", async () => {
    mockAuth.mockResolvedValue(null as any);
    mockVerify.mockReturnValue({ action: "deny", approvalId: "req-1" } as any);

    const req = new NextRequest(
      "http://localhost/api/approvals/req-1/approve?token=tok",
      { method: "POST", body: JSON.stringify({}) },
    );

    const res = await POST(req, { params: Promise.resolve({ id: "req-1" }) });
    expect(res.status).toBe(403);
  });

  it("approves and executes with session auth", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as any);
    mockExecute.mockResolvedValue({
      decisionRecord: { decision: "APPROVE" },
      request: {
        userId: "user-1",
        user: { emailAccounts: [{ id: "email-1" }] },
      },
      toolName: "reply",
      executionResult: { ok: true },
    } as any);

    const req = new NextRequest("http://localhost/api/approvals/req-1/approve", {
      method: "POST",
      body: JSON.stringify({ reason: "ok" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "req-1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ approvalRequestId: "req-1" }),
    );
    expect(json).toEqual(
      expect.objectContaining({ execution: { ok: true } }),
    );
  });

  it("approves using surface identity when session/token are absent", async () => {
    mockAuth.mockResolvedValue(null as any);
    prisma.account.findUnique.mockResolvedValue({ userId: "user-1" } as any);
    mockExecute.mockResolvedValue({
      decisionRecord: { decision: "APPROVE" },
      request: {
        userId: "user-1",
        user: { emailAccounts: [{ id: "email-1" }] },
      },
      toolName: "delete",
      executionResult: { ok: true },
    } as any);

    const req = new NextRequest("http://localhost/api/approvals/req-1/approve", {
      method: "POST",
      headers: {
        "x-surfaces-secret": "surfaces-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        provider: "slack",
        userId: "U123456",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "req-1" }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ approvalRequestId: "req-1", decidedByUserId: "user-1" }),
    );
    expect(json).toEqual(expect.objectContaining({ execution: { ok: true } }));
  });

  it("returns 403 when session user mismatches", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-2" } } as any);

    const req = new NextRequest("http://localhost/api/approvals/req-1/approve", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "req-1" }) });
    expect(res.status).toBe(403);
  });
});
