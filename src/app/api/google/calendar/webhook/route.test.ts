import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";
import { syncGoogleCalendarChanges } from "@/features/calendar/sync/google";

vi.mock("@/server/lib/middleware", () => ({
  withError: (_scope: string, handler: any) => handler,
}));
vi.mock("@/server/db/client");
vi.mock("@/features/calendar/sync/google", () => ({
  syncGoogleCalendarChanges: vi.fn(),
}));
vi.mock("@/features/calendar/scheduling/TaskSchedulingService", () => ({
  scheduleTasksForUser: vi.fn(),
}));
vi.mock("@/features/notifications/create", () => ({
  createInAppNotification: vi.fn(),
}));
vi.mock("@/features/calendar/action-log", () => ({
  wasRecentCalendarAction: vi.fn().mockResolvedValue(false),
}));

describe("POST /api/google/calendar/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when headers missing", async () => {
    const req = new Request("http://localhost/api/google/calendar/webhook", {
      method: "POST",
    });
    const res = await POST(req as any, {} as any);
    expect(res.status).toBe(400);
  });

  it("returns ok when calendar not found", async () => {
    prisma.calendar.findFirst.mockResolvedValue(null);
    const req = new Request("http://localhost/api/google/calendar/webhook", {
      method: "POST",
      headers: {
        "x-goog-channel-id": "ch-1",
        "x-goog-resource-id": "res-1",
      },
    });
    const res = await POST(req as any, {} as any);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("returns 403 on channel token mismatch", async () => {
    prisma.calendar.findFirst.mockResolvedValue({
      id: "cal-1",
      calendarId: "primary",
      googleChannelId: "ch-1",
      googleResourceId: "res-1",
      googleChannelToken: "token-1",
      connection: {
        emailAccountId: "email-1",
        accessToken: "a",
        refreshToken: "r",
        expiresAt: null,
        emailAccount: { userId: "user-1" },
      },
    } as any);
    const req = new Request("http://localhost/api/google/calendar/webhook", {
      method: "POST",
      headers: {
        "x-goog-channel-id": "ch-1",
        "x-goog-resource-id": "res-1",
        "x-goog-channel-token": "wrong",
      },
    });
    const res = await POST(req as any, {} as any);
    expect(res.status).toBe(403);
  });

  it("syncs calendar changes when valid", async () => {
    prisma.calendar.findFirst.mockResolvedValue({
      id: "cal-1",
      calendarId: "primary",
      googleSyncToken: null,
      googleChannelId: "ch-1",
      googleResourceId: "res-1",
      googleChannelToken: "token-1",
      googleChannelExpiresAt: null,
      connection: {
        emailAccountId: "email-1",
        accessToken: "a",
        refreshToken: "r",
        expiresAt: null,
        emailAccount: { userId: "user-1" },
      },
    } as any);
    vi.mocked(syncGoogleCalendarChanges).mockResolvedValue({
      changed: false,
      items: [],
    } as any);

    const req = new Request("http://localhost/api/google/calendar/webhook", {
      method: "POST",
      headers: {
        "x-goog-channel-id": "ch-1",
        "x-goog-resource-id": "res-1",
        "x-goog-channel-token": "token-1",
      },
    });
    const res = await POST(req as any, {} as any);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(syncGoogleCalendarChanges).toHaveBeenCalled();
  });
});
