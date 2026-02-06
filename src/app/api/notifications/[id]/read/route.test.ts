import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";
import { auth } from "@/server/auth";

vi.mock("@/server/db/client");
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));

const mockAuth = vi.mocked(auth);

describe("POST /api/notifications/[id]/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    const req = new NextRequest("http://localhost/api/notifications/n1/read", {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({ id: "n1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when notification not found", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as any);
    prisma.inAppNotification.updateMany.mockResolvedValue({ count: 0 } as any);
    prisma.inAppNotification.findFirst.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/notifications/n1/read", {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({ id: "n1" }) });
    expect(res.status).toBe(404);
  });

  it("returns alreadyRead when already read", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as any);
    prisma.inAppNotification.updateMany.mockResolvedValue({ count: 0 } as any);
    prisma.inAppNotification.findFirst.mockResolvedValue({ id: "n1" } as any);

    const req = new NextRequest("http://localhost/api/notifications/n1/read", {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({ id: "n1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.alreadyRead).toBe(true);
  });

  it("marks notification as read", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as any);
    prisma.inAppNotification.updateMany.mockResolvedValue({ count: 1 } as any);

    const req = new NextRequest("http://localhost/api/notifications/n1/read", {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({ id: "n1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(prisma.inAppNotification.updateMany).toHaveBeenCalledWith({
      where: { id: "n1", userId: "user-1", isRead: false },
      data: { isRead: true, readAt: expect.any(Date) },
    });
  });
});
