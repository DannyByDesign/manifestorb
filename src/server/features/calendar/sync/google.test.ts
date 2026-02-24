import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ensureGoogleCalendarWatch,
  syncGoogleCalendarChanges,
} from "@/server/features/calendar/sync/google";
import prisma from "@/server/lib/__mocks__/prisma";
import { getCalendarClientWithRefresh } from "@/features/calendar/client";
import {
  buildCalendarEventSnapshot,
  markCalendarEventShadowDeleted,
  upsertCalendarEventShadow,
} from "@/features/calendar/canonical-state";

const mockEnv = vi.hoisted(() => ({
  NEXT_PUBLIC_BASE_URL: "http://localhost:3000" as string | undefined,
}));
vi.mock("@/env", () => ({ env: mockEnv }));

vi.mock("@/server/db/client");
vi.mock("@/features/calendar/client", () => ({
  getCalendarClientWithRefresh: vi.fn(),
}));
vi.mock("@/features/calendar/canonical-state", () => ({
  buildCalendarEventSnapshot: vi.fn().mockReturnValue({ id: "snapshot-1" }),
  markCalendarEventShadowDeleted: vi.fn().mockResolvedValue(false),
  upsertCalendarEventShadow: vi.fn().mockResolvedValue({
    shadowId: "shadow-1",
    remapped: false,
  }),
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
    prisma.calendar.updateMany.mockResolvedValue({ count: 1 } as never);
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

  it("skips watch for known non-push calendars", async () => {
    mockEnv.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";

    await ensureGoogleCalendarWatch({
      calendar: {
        id: "cal-1",
        calendarId: "en.usa#holiday@group.v.calendar.google.com",
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
    expect(prisma.calendar.update).not.toHaveBeenCalled();
  });

  it("treats pushNotSupportedForRequestedResource as a non-fatal watch skip", async () => {
    mockEnv.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";
    vi.mocked(getCalendarClientWithRefresh).mockResolvedValue({
      channels: { stop: vi.fn().mockResolvedValue(undefined) },
      events: {
        watch: vi.fn().mockRejectedValue({
          response: {
            status: 400,
            data: {
              error: {
                errors: [
                  {
                    reason: "pushNotSupportedForRequestedResource",
                    message:
                      "Push notifications are not supported by this resource.",
                  },
                ],
                code: 400,
                message:
                  "Push notifications are not supported by this resource.",
              },
            },
          },
        }),
      },
    } as any);

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

    expect(logger.info).toHaveBeenCalledWith(
      "Skipping Google calendar watch for unsupported resource",
      expect.objectContaining({
        calendarId: "primary",
        reason: "push_not_supported",
      }),
    );
    expect(prisma.calendar.update).not.toHaveBeenCalled();
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
    expect(prisma.calendar.updateMany).toHaveBeenCalledWith({
      where: {
        id: "cal-1",
        googleSyncToken: "prev",
      },
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
    expect(prisma.calendar.updateMany).toHaveBeenCalledWith({
      where: {
        id: "cal-1",
        googleSyncToken: "prev",
      },
      data: { googleSyncToken: "sync-2" },
    });
  });

  it("repro: 410 recovery should run canonical reconciliation, not skip it", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce({ code: 410 })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: "evt-410",
              summary: "Recovered event",
              status: "confirmed",
              start: { dateTime: "2026-02-24T10:00:00.000Z" },
              end: { dateTime: "2026-02-24T11:00:00.000Z" },
            },
          ],
          nextSyncToken: "sync-410",
        },
      });
    vi.mocked(getCalendarClientWithRefresh).mockResolvedValue({
      events: { list },
    } as never);

    const result = await syncGoogleCalendarChanges({
      calendar: {
        id: "cal-1",
        calendarId: "primary",
        googleSyncToken: "expired-token",
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
      userId: "user-1",
    });

    expect(upsertCalendarEventShadow).toHaveBeenCalled();
    expect(buildCalendarEventSnapshot).toHaveBeenCalled();
    expect(markCalendarEventShadowDeleted).not.toHaveBeenCalled();
    expect(result.canonical.processed).toBe(1);
  });

  it("dedupes canonical reconciliation when replay pages contain duplicate event ids", async () => {
    const duplicateEvent = {
      id: "evt-dup",
      summary: "Duplicate event",
      status: "confirmed",
      start: { dateTime: "2026-02-24T10:00:00.000Z" },
      end: { dateTime: "2026-02-24T11:00:00.000Z" },
    };
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          items: [duplicateEvent],
          nextPageToken: "page-2",
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [duplicateEvent],
          nextSyncToken: "sync-dup",
        },
      });
    vi.mocked(getCalendarClientWithRefresh).mockResolvedValue({
      events: { list },
    } as never);

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
      userId: "user-1",
    });

    expect(upsertCalendarEventShadow).toHaveBeenCalledTimes(1);
    expect(result.canonical.processed).toBe(1);
  });

  it("repro: sync token writes should be monotonic/CAS guarded", async () => {
    vi.mocked(getCalendarClientWithRefresh).mockResolvedValue({
      events: {
        list: vi.fn().mockResolvedValue({
          data: {
            items: [],
            nextSyncToken: "sync-new",
          },
        }),
      },
    } as never);

    prisma.calendar.updateMany.mockResolvedValue({ count: 0 } as never);

    await syncGoogleCalendarChanges({
      calendar: {
        id: "cal-1",
        calendarId: "primary",
        googleSyncToken: "sync-old",
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

    expect(prisma.calendar.updateMany).toHaveBeenCalledWith({
      where: {
        id: "cal-1",
        googleSyncToken: "sync-old",
      },
      data: {
        googleSyncToken: "sync-new",
      },
    });
    expect(prisma.calendar.update).not.toHaveBeenCalledWith({
      where: { id: "cal-1" },
      data: { googleSyncToken: "sync-new" },
    });
  });
});
