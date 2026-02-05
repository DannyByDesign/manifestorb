import { describe, it, expect, beforeEach, vi } from "vitest";
import { createInAppNotification } from "@/server/features/notifications/create";
import prisma from "@/server/lib/__mocks__/prisma";
import { getQstashClient } from "@/server/integrations/qstash";
import { getInternalApiUrl } from "@/server/lib/internal-api";

vi.mock("@/server/db/client");
vi.mock("@/server/integrations/qstash", () => ({
  getQstashClient: vi.fn(),
}));
vi.mock("@/server/lib/internal-api", () => ({
  getInternalApiUrl: vi.fn(),
}));

const mockQstashClient = {
  publishJSON: vi.fn().mockResolvedValue({ messageId: "msg-1" }),
};

describe("createInAppNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getInternalApiUrl).mockReturnValue("http://localhost:3000");
  });

  it("creates notification and schedules fallback", async () => {
    vi.mocked(getQstashClient).mockReturnValue(mockQstashClient as any);
    prisma.inAppNotification.create.mockResolvedValue({
      id: "notif-1",
      userId: "user-1",
    } as any);

    const result = await createInAppNotification({
      userId: "user-1",
      title: "Hello",
      body: "Body",
      type: "info",
      dedupeKey: "dedupe-1",
    });

    expect(result?.id).toBe("notif-1");
    expect(mockQstashClient.publishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://localhost:3000/api/notifications/fallback",
        body: { id: "notif-1" },
        delay: 15,
        deduplicationId: "fallback-dedupe-1",
      }),
    );
  });

  it("skips fallback scheduling when qstash is unavailable", async () => {
    vi.mocked(getQstashClient).mockReturnValue(null as any);
    prisma.inAppNotification.create.mockResolvedValue({
      id: "notif-2",
    } as any);

    const result = await createInAppNotification({
      userId: "user-1",
      title: "Hello",
    });

    expect(result?.id).toBe("notif-2");
  });

  it("returns null on duplicate dedupeKey", async () => {
    vi.mocked(getQstashClient).mockReturnValue(mockQstashClient as any);
    prisma.inAppNotification.create.mockRejectedValue({ code: "P2002" });

    const result = await createInAppNotification({
      userId: "user-1",
      title: "Hello",
      dedupeKey: "dup",
    });

    expect(result).toBeNull();
  });
});
