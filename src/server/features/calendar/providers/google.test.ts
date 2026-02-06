import { describe, it, expect, beforeEach, vi } from "vitest";
import { createGoogleCalendarProvider } from "@/server/features/calendar/providers/google";
import prisma from "@/server/lib/__mocks__/prisma";
import {
  getCalendarOAuth2Client,
  fetchGoogleCalendars,
  getCalendarClientWithRefresh,
} from "@/features/calendar/client";
import { GoogleCalendarEventProvider } from "@/features/calendar/providers/google-events";
import {
  ensureGoogleCalendarWatch,
  syncGoogleCalendarChanges,
} from "@/server/features/calendar/sync/google";
import { autoPopulateTimezone } from "@/server/features/calendar/timezone-helpers";
import {
  createGoogleEvent,
  updateGoogleEvent,
  deleteGoogleEvent,
} from "@/server/integrations/google/calendar";

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
vi.mock("@/server/integrations/google/calendar", () => ({
  createGoogleEvent: vi.fn(),
  updateGoogleEvent: vi.fn(),
  deleteGoogleEvent: vi.fn(),
  getGoogleEvent: vi.fn(),
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

describe("GoogleCalendarEventProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates events with a default time zone", async () => {
    vi.mocked(createGoogleEvent).mockResolvedValue({
      id: "event-1",
      summary: "Meet",
      start: { dateTime: "2024-05-01T10:00:00Z" },
      end: { dateTime: "2024-05-01T11:00:00Z" },
    } as unknown as object);

    const provider = new GoogleCalendarEventProvider(
      {
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: null,
        emailAccountId: "email-1",
        userId: "user-1",
        timeZone: "America/Los_Angeles",
      },
      logger,
    );

    await provider.createEvent("primary", {
      title: "Meet",
      start: new Date("2024-05-01T10:00:00Z"),
      end: new Date("2024-05-01T11:00:00Z"),
    });

    expect(createGoogleEvent).toHaveBeenCalledWith(
      expect.any(Object),
      "primary",
      expect.objectContaining({
        timeZone: "America/Los_Angeles",
      }),
    );
  });

  it("updates events with a default time zone", async () => {
    vi.mocked(updateGoogleEvent).mockResolvedValue({
      id: "event-2",
      summary: "Update",
      start: { dateTime: "2024-05-02T10:00:00Z" },
      end: { dateTime: "2024-05-02T11:00:00Z" },
    } as unknown as object);

    const provider = new GoogleCalendarEventProvider(
      {
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: null,
        emailAccountId: "email-1",
        userId: "user-1",
        timeZone: "UTC",
      },
      logger,
    );

    await provider.updateEvent("primary", "event-2", {
      title: "Update",
      start: new Date("2024-05-02T10:00:00Z"),
      end: new Date("2024-05-02T11:00:00Z"),
    });

    expect(updateGoogleEvent).toHaveBeenCalledWith(
      expect.any(Object),
      "primary",
      "event-2",
      expect.objectContaining({
        timeZone: "UTC",
      }),
    );
  });

  it("deletes events with the provided mode", async () => {
    vi.mocked(deleteGoogleEvent).mockResolvedValue(undefined);

    const provider = new GoogleCalendarEventProvider(
      {
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: null,
        emailAccountId: "email-1",
        userId: "user-1",
      },
      logger,
    );

    await provider.deleteEvent("primary", "event-3", { mode: "series" });

    expect(deleteGoogleEvent).toHaveBeenCalledWith(
      expect.any(Object),
      "primary",
      "event-3",
      "series",
    );
  });
});
