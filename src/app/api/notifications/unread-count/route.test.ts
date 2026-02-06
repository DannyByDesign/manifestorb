import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";
import { auth } from "@/server/auth";

vi.mock("@/server/db/client");
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));

const mockAuth = vi.mocked(auth);

describe("GET /api/notifications/unread-count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    const req = new NextRequest("http://localhost/api/notifications/unread-count");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns unread count", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as any);
    prisma.inAppNotification.count.mockResolvedValue(4 as any);

    const req = new NextRequest("http://localhost/api/notifications/unread-count");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.count).toBe(4);
    expect(prisma.inAppNotification.count).toHaveBeenCalledWith({
      where: { userId: "user-1", isRead: false },
    });
  });
});
