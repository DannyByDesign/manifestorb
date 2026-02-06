import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";
import { auth } from "@/server/auth";

vi.mock("@/server/db/client");
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));

const mockAuth = vi.mocked(auth);

describe("GET /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as any);
    const req = new NextRequest("http://localhost/api/notifications");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns notifications for user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as any);
    prisma.inAppNotification.findMany.mockResolvedValue([
      { id: "n1" },
      { id: "n2" },
    ] as any);

    const req = new NextRequest("http://localhost/api/notifications");
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.notifications).toHaveLength(2);
    expect(prisma.inAppNotification.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });
});
