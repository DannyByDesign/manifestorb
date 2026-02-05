import { describe, it, expect, beforeEach, vi } from "vitest";
import { createGoogleCalendarProvider } from "@/server/features/calendar/providers/google";
import prisma from "@/server/lib/__mocks__/prisma";
import {
  getCalendarOAuth2Client,
  fetchGoogleCalendars,
  getCalendarClientWithRefresh,
} from "@/features/calendar/client";
import {
  ensureGoogleCalendarWatch,
  syncGoogleCalendarChanges,
} from "@/server/features/calendar/sync/google";
import { autoPopulateTimezone } from "@/server/features/calendar/timezone-helpers";

vi.mock("@/server/db/client");
vi.mock("@/features/calendar/client", () => ({
  getCalendarOAuth2Client: vi.fn(),
  fetchGoogleCalendars: vi.fn(),
  getCalendarClientWithRefresh: vi.fn(),
}));
vi.mock("@/server/features/calendar/sync/google", () => ({
  ensureGoogleCalendarWatch: vi.fn(),
  syncGoogleCalendarChanges: vi.fn(),
}));
vi.mock("@/server/features/calendar/timezone-helpers", () => ({
  autoPopulateTimezone: vi.fn(),
}));

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  with: vi.fn().mockReturnThis(),
} as any;

describe("createGoogleCalendarProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exchanges code for tokens and email", async () => {
    vi.mocked(getCalendarOAuth2Client).mockReturnValue({
      getToken: vi.fn().mockResolvedValue({
        tokens: {
          id_token: "id",
          access_token: "a",
          refresh_token: "r",
          expiry_date: Date.now(),
        },
      }),
      verifyIdToken: vi.fn().mockResolvedValue({
        getPayload: () => ({ email: "user@test.com" }),
      }),
    } as any);

    const provider = createGoogleCalendarProvider(logger);
    const tokens = await provider.exchangeCodeForTokens("code");

    expect(tokens.email).toBe("user@test.com");
    expect(tokens.accessToken).toBe("a");
  });

  it("syncs calendars and schedules watches", async () => {
    vi.mocked(getCalendarClientWithRefresh).mockResolvedValue({} as any);
    vi.mocked(fetchGoogleCalendars).mockResolvedValue([
      { id: "cal-1", summary: "Primary", timeZone: "UTC" },
    ] as any);
    prisma.calendar.upsert.mockResolvedValue({
      id: "cal-1",
      calendarId: "cal-1",
      googleSyncToken: null,
      googleChannelId: null,
      googleResourceId: null,
      googleChannelToken: null,
      googleChannelExpiresAt: null,
    } as any);

    const provider = createGoogleCalendarProvider(logger);
    await provider.syncCalendars("conn-1", "a", "r", "email-1", null);

    expect(ensureGoogleCalendarWatch).toHaveBeenCalled();
    expect(syncGoogleCalendarChanges).toHaveBeenCalled();
    expect(autoPopulateTimezone).toHaveBeenCalled();
  });
});
