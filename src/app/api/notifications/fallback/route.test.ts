import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");
class MockChannelRouter {
  pushMessage = vi.fn().mockResolvedValue(true);
}

vi.mock("@/features/channels/router", () => ({
  ChannelRouter: MockChannelRouter,
}));

describe("POST /api/notifications/fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when id is missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/notifications/fallback", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns skipped when already claimed or pushed", async () => {
    prisma.inAppNotification.updateMany.mockResolvedValue({ count: 0 } as any);

    const res = await POST(
      new Request("http://localhost/api/notifications/fallback", {
        method: "POST",
        body: JSON.stringify({ id: "n1" }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("skipped");
  });

  it("pushes notification when eligible", async () => {
    prisma.inAppNotification.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.inAppNotification.findUnique.mockResolvedValue({
      id: "n1",
      userId: "user-1",
      title: "Title",
      body: "Body",
    } as any);

    const res = await POST(
      new Request("http://localhost/api/notifications/fallback", {
        method: "POST",
        body: JSON.stringify({ id: "n1" }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("pushed");
    expect(json.success).toBe(true);
  });
});
