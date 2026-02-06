import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";
import { auth } from "@/server/auth";

vi.mock("@/server/db/client");
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));

const mockAuth = vi.mocked(auth);

describe("POST /api/notifications/read-all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    const req = new NextRequest("http://localhost/api/notifications/read-all", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("marks all notifications as read", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as any);
    prisma.inAppNotification.updateMany.mockResolvedValue({ count: 3 } as any);

    const req = new NextRequest("http://localhost/api/notifications/read-all", {
      method: "POST",
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.markedAsRead).toBe(3);
    expect(prisma.inAppNotification.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", isRead: false },
      data: { isRead: true, readAt: expect.any(Date) },
    });
  });
});
