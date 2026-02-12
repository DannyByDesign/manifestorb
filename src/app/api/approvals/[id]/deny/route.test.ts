import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";
import { auth } from "@/server/auth";
import { verifyApprovalActionToken } from "@/features/approvals/action-token";
import { deleteUserDraftById } from "@/features/drafts/service";

vi.mock("@/server/db/client");
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));
vi.mock("@/features/approvals/action-token", () => ({
  verifyApprovalActionToken: vi.fn(),
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
  createGenerateText: vi.fn().mockReturnValue(async () => ({ text: "Ok." })),
}));
vi.mock("@/server/lib/llms/model", () => ({
  getModel: vi.fn().mockReturnValue({ model: "mock" }),
}));
vi.mock("@/features/drafts/service", () => ({
  deleteUserDraftById: vi.fn(),
}));

const mockAuth = vi.mocked(auth);
const mockVerify = vi.mocked(verifyApprovalActionToken);
const mockDeleteUserDraftById = vi.mocked(deleteUserDraftById);

describe("POST /api/approvals/[id]/deny", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteUserDraftById.mockResolvedValue({ success: true, emailAccountId: "email-1" } as any);
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
        userId: "user-1",
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

  it("denies using surface identity when session/token are absent", async () => {
    mockAuth.mockResolvedValue(null as any);
    prisma.account.findUnique.mockResolvedValue({ userId: "user-1" } as any);
    prisma.approvalRequest.findUnique
      .mockResolvedValueOnce({ userId: "user-1" } as any)
      .mockResolvedValueOnce({
        id: "req-1",
        userId: "user-1",
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
      headers: {
        "x-surfaces-secret": "surfaces-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        provider: "discord",
        userId: "998877",
      }),
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

  it("discards draft when denying send_draft approval", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as any);
    prisma.approvalRequest.findUnique
      .mockResolvedValueOnce({ userId: "user-1" } as any)
      .mockResolvedValueOnce({
        id: "req-1",
        userId: "user-1",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 60_000),
      } as any)
      .mockResolvedValueOnce({
        id: "req-1",
        userId: "user-1",
        user: {
          emailAccounts: [{ id: "email-1", account: { provider: "google" } }],
        },
        requestPayload: {
          actionType: "send_draft",
          draftId: "draft-123",
          emailAccountId: "email-1",
        },
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
      body: JSON.stringify({ reason: "not now" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "req-1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockDeleteUserDraftById).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        draftId: "draft-123",
        emailAccountId: "email-1",
      }),
    );
    expect(json.draftCleanup).toEqual({ deleted: true, error: undefined });
  });
});
