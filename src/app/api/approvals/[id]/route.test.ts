import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";
import { auth } from "@/server/auth";

vi.mock("@/server/db/client");
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));

const mockAuth = vi.mocked(auth);

describe("GET /api/approvals/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    const req = new NextRequest("http://localhost/api/approvals/req-1");

    const res = await GET(req, { params: Promise.resolve({ id: "req-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when approval request is missing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as any);
    prisma.approvalRequest.findUnique.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/approvals/req-1");
    const res = await GET(req, { params: Promise.resolve({ id: "req-1" }) });

    expect(res.status).toBe(404);
  });

  it("returns 403 when user does not own request", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as any);
    prisma.approvalRequest.findUnique.mockResolvedValue({ userId: "user-2" } as any);

    const req = new NextRequest("http://localhost/api/approvals/req-1");
    const res = await GET(req, { params: Promise.resolve({ id: "req-1" }) });

    expect(res.status).toBe(403);
  });

  it("returns approval request when authorized", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as any);
    prisma.approvalRequest.findUnique.mockResolvedValueOnce({
      userId: "user-1",
    } as any);
    prisma.approvalRequest.findUnique.mockResolvedValueOnce({
      id: "req-1",
      userId: "user-1",
      decisions: [],
    } as any);

    const req = new NextRequest("http://localhost/api/approvals/req-1");
    const res = await GET(req, { params: Promise.resolve({ id: "req-1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(
      expect.objectContaining({ id: "req-1", userId: "user-1" }),
    );
  });
});
