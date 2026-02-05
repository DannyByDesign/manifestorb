import { describe, it, expect, beforeEach, vi } from "vitest";
import { createGoogleAvailabilityProvider } from "@/server/features/calendar/providers/google-availability";
import { getCalendarClientWithRefresh } from "@/server/features/calendar/client";

vi.mock("@/server/features/calendar/client", () => ({
  getCalendarClientWithRefresh: vi.fn(),
}));

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
} as any;

describe("createGoogleAvailabilityProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns busy periods from freebusy", async () => {
    vi.mocked(getCalendarClientWithRefresh).mockResolvedValue({
      freebusy: {
        query: vi.fn().mockResolvedValue({
          data: {
            calendars: {
              "cal-1": {
                busy: [
                  { start: "2024-01-01T10:00:00Z", end: "2024-01-01T11:00:00Z" },
                ],
              },
            },
          },
        }),
      },
    } as any);

    const provider = createGoogleAvailabilityProvider(logger);
    const result = await provider.fetchBusyPeriods({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: null,
      emailAccountId: "email-1",
      calendarIds: ["cal-1"],
      timeMin: "2024-01-01T00:00:00Z",
      timeMax: "2024-01-02T00:00:00Z",
    });

    expect(result).toEqual([
      { start: "2024-01-01T10:00:00Z", end: "2024-01-01T11:00:00Z" },
    ]);
  });
});
