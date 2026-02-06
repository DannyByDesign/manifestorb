import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleCalendarProvider } from "@/server/features/calendar/providers/google";
import prisma from "@/server/lib/__mocks__/prisma";
import { getCalendarClientWithRefresh } from "@/features/calendar/client";
import type { Logger } from "@/server/lib/logger";

vi.mock("@/server/db/client");
vi.mock("@/features/calendar/client", () => ({
  getCalendarOAuth2Client: vi.fn(),
  fetchGoogleCalendars: vi.fn(),
  getCalendarClientWithRefresh: vi.fn(),
}));

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  with: vi.fn().mockReturnThis(),
} as unknown as Logger;

describe("calendar sync error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks connection disconnected when sync fails", async () => {
    vi.mocked(getCalendarClientWithRefresh).mockRejectedValue(
      new Error("sync failed"),
    );

    const provider = createGoogleCalendarProvider(logger);

    await expect(
      provider.syncCalendars(
        "conn-1",
        "access",
        "refresh",
        "email-1",
        null,
      ),
    ).rejects.toThrow("sync failed");

    expect(prisma.calendarConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conn-1" },
        data: { isConnected: false },
      }),
    );
  });
});
