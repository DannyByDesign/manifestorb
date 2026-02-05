import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "./route";
import prisma from "@/server/lib/__mocks__/prisma";
import { ensureGoogleCalendarWatch } from "@/features/calendar/sync/google";

vi.mock("@/server/db/client");
vi.mock("@/features/calendar/sync/google", () => ({
  ensureGoogleCalendarWatch: vi.fn(),
}));
vi.mock("@/env", () => ({
  env: { CRON_SECRET: "secret" },
}));

describe("POST /api/google/calendar/watch/renew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthorized", async () => {
    const req = new Request("http://localhost/api/google/calendar/watch/renew", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("renews calendar watches", async () => {
    prisma.calendar.findMany.mockResolvedValue([
      {
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
        },
      },
    ] as any);
    vi.mocked(ensureGoogleCalendarWatch).mockResolvedValue(undefined as any);

    const req = new Request("http://localhost/api/google/calendar/watch/renew", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
    });
    const res = await POST(req);
    const json = await res.json();

    expect(json.successful).toBe(1);
    expect(ensureGoogleCalendarWatch).toHaveBeenCalled();
  });
});
