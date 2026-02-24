import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInAppNotification } from "@/server/features/notifications/create";
import { POST as fallbackPost } from "@/app/api/notifications/fallback/route";
import prisma from "@/server/lib/__mocks__/prisma";
import { getQstashClient } from "@/server/integrations/qstash";

vi.mock("@/server/db/client");
vi.mock("@/server/integrations/qstash", () => ({
  getQstashClient: vi.fn(),
}));

const { pushMessageMock } = vi.hoisted(() => ({
  pushMessageMock: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/features/channels/router", () => ({
  ChannelRouter: class {
    pushMessage = pushMessageMock;
  },
}));

describe("E2E notifications fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushMessageMock.mockResolvedValue(true);
  });

  it("creates notification and pushes via fallback", async () => {
    vi.mocked(getQstashClient).mockReturnValue(null as any);
    prisma.inAppNotification.create.mockResolvedValue({
      id: "notif-1",
      userId: "user-1",
      title: "Title",
      body: "Body",
    } as any);
    prisma.inAppNotification.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.inAppNotification.findUnique.mockResolvedValue({
      id: "notif-1",
      userId: "user-1",
      title: "Title",
      body: "Body",
    } as any);

    const notification = await createInAppNotification({
      userId: "user-1",
      title: "Title",
      body: "Body",
    });

    const res = await fallbackPost(
      new Request("http://localhost/api/notifications/fallback", {
        method: "POST",
        body: JSON.stringify({ id: notification?.id }),
      }),
    );
    const json = await res.json();

    expect(json.status).toBe("pushed");
  });
});
