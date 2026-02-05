import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ensureGoogleCalendarWatch,
  syncGoogleCalendarChanges,
} from "@/server/features/calendar/sync/google";
import prisma from "@/server/lib/__mocks__/prisma";
import { getCalendarClientWithRefresh } from "@/features/calendar/client";

const mockEnv = vi.hoisted(() => ({
  NEXT_PUBLIC_BASE_URL: "http://localhost:3000" as string | undefined,
}));
vi.mock("@/env", () => ({ env: mockEnv }));

vi.mock("@/server/db/client");
vi.mock("@/features/calendar/client", () => ({
  getCalendarClientWithRefresh: vi.fn(),
}));

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
} as any;

describe("calendar sync/google", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips watch when base url missing", async () => {
    mockEnv.NEXT_PUBLIC_BASE_URL = undefined;
    await ensureGoogleCalendarWatch({
      calendar: {
        id: "cal-1",
        calendarId: "primary",
        googleSyncToken: null,
        googleChannelId: null,
        googleResourceId: null,
        googleChannelToken: null,
        googleChannelExpiresAt: null,
      },
      connection: {
        accessToken: "a",
        refreshToken: "r",
        expiresAt: null,
        emailAccountId: "email-1",
      },
      logger,
    });
    expect(getCalendarClientWithRefresh).not.toHaveBeenCalled();
  });

  it("watches calendar and updates channel info", async () => {
    mockEnv.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";
    vi.mocked(getCalendarClientWithRefresh).mockResolvedValue({
      channels: { stop: vi.fn().mockResolvedValue(undefined) },
      events: {
        watch: vi.fn().mockResolvedValue({
          data: { resourceId: "res-1", expiration: `${Date.now() + 1000}` },
        }),
      },
    } as any);

    await ensureGoogleCalendarWatch({
      calendar: {
        id: "cal-1",
        calendarId: "primary",
        googleSyncToken: null,
        googleChannelId: "old",
        googleResourceId: "old-res",
        googleChannelToken: null,
        googleChannelExpiresAt: null,
      },
      connection: {
        accessToken: "a",
        refreshToken: "r",
        expiresAt: null,
        emailAccountId: "email-1",
      },
      logger,
    });

    expect(prisma.calendar.update).toHaveBeenCalled();
  });

  it("syncs calendar changes and updates sync token", async () => {
    vi.mocked(getCalendarClientWithRefresh).mockResolvedValue({
      events: {
        list: vi.fn().mockResolvedValue({
          data: {
            items: [{ id: "evt-1" }],
            nextSyncToken: "sync-1",
          },
        }),
      },
    } as any);

    const result = await syncGoogleCalendarChanges({
      calendar: {
        id: "cal-1",
        calendarId: "primary",
        googleSyncToken: "prev",
        googleChannelId: null,
        googleResourceId: null,
        googleChannelToken: null,
        googleChannelExpiresAt: null,
      },
      connection: {
        accessToken: "a",
        refreshToken: "r",
        expiresAt: null,
        emailAccountId: "email-1",
      },
      logger,
    });

    expect(result.changed).toBe(true);
    expect(prisma.calendar.update).toHaveBeenCalledWith({
      where: { id: "cal-1" },
      data: { googleSyncToken: "sync-1" },
    });
  });

  it("resets sync token on 410 errors", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce({ code: 410 })
      .mockResolvedValueOnce({
        data: { items: [], nextSyncToken: "sync-2" },
      });
    vi.mocked(getCalendarClientWithRefresh).mockResolvedValue({
      events: { list },
    } as any);

    const result = await syncGoogleCalendarChanges({
      calendar: {
        id: "cal-1",
        calendarId: "primary",
        googleSyncToken: "prev",
        googleChannelId: null,
        googleResourceId: null,
        googleChannelToken: null,
        googleChannelExpiresAt: null,
      },
      connection: {
        accessToken: "a",
        refreshToken: "r",
        expiresAt: null,
        emailAccountId: "email-1",
      },
      logger,
    });

    expect(result.changed).toBe(false);
    expect(prisma.calendar.update).toHaveBeenCalledWith({
      where: { id: "cal-1" },
      data: { googleSyncToken: "sync-2" },
    });
  });
});
