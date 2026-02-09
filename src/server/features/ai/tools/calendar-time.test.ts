import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({
  default: {
    emailAccount: {
      findUnique: vi.fn(),
    },
    calendar: {
      findFirst: vi.fn(),
    },
    taskPreference: {
      findUnique: vi.fn(),
    },
  },
}));

import prisma from "@/server/db/client";
import {
  resolveCalendarTimeRange,
  resolveDefaultCalendarTimeZone,
} from "./calendar-time";

function resetMocks() {
  vi.mocked((prisma as any).emailAccount.findUnique).mockReset();
  vi.mocked((prisma as any).calendar.findFirst).mockReset();
  vi.mocked((prisma as any).taskPreference.findUnique).mockReset();
}

describe("calendar-time helpers", () => {
  it("prefers email account timezone", async () => {
    resetMocks();
    vi.mocked((prisma as any).emailAccount.findUnique).mockResolvedValueOnce({
      timezone: "America/Los_Angeles",
    });
    const result = await resolveDefaultCalendarTimeZone({
      userId: "u-1",
      emailAccountId: "e-1",
    });
    expect(result).toEqual({
      timeZone: "America/Los_Angeles",
      source: "integration",
    });
  });

  it("falls back to primary connected calendar timezone", async () => {
    resetMocks();
    vi.mocked((prisma as any).emailAccount.findUnique).mockResolvedValueOnce({
      timezone: null,
    });
    vi.mocked((prisma as any).calendar.findFirst)
      .mockResolvedValueOnce({ timezone: "America/New_York" })
      .mockResolvedValueOnce(null);
    const result = await resolveDefaultCalendarTimeZone({
      userId: "u-1",
      emailAccountId: "e-1",
    });
    expect(result).toEqual({
      timeZone: "America/New_York",
      source: "integration_primary_calendar",
    });
  });

  it("falls back to user preference, then returns an explicit error when unresolved", async () => {
    resetMocks();
    vi.mocked((prisma as any).emailAccount.findUnique).mockResolvedValueOnce({
      timezone: null,
    });
    vi.mocked((prisma as any).calendar.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked((prisma as any).taskPreference.findUnique).mockResolvedValueOnce({
      timeZone: "Europe/London",
    });
    await expect(
      resolveDefaultCalendarTimeZone({ userId: "u-1", emailAccountId: "e-1" }),
    ).resolves.toEqual({
      timeZone: "Europe/London",
      source: "preference",
    });

    resetMocks();
    vi.mocked((prisma as any).emailAccount.findUnique).mockResolvedValueOnce({
      timezone: null,
    });
    vi.mocked((prisma as any).calendar.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    vi.mocked((prisma as any).taskPreference.findUnique).mockResolvedValueOnce(
      null,
    );
    await expect(
      resolveDefaultCalendarTimeZone({ userId: "u-1", emailAccountId: "e-1" }),
    ).resolves.toEqual({
      error:
        "Unable to determine calendar timezone. Please set a timezone in your connected calendar integration settings.",
    });
  });

  it("uses timezone-aware today window when no dateRange is provided", async () => {
    resetMocks();
    vi.mocked((prisma as any).emailAccount.findUnique).mockResolvedValueOnce({
      timezone: "America/Los_Angeles",
    });
    const result = await resolveCalendarTimeRange({
      userId: "u-1",
      emailAccountId: "e-1",
      defaultWindow: "today",
      missingBoundDurationMs: 24 * 60 * 60 * 1000,
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.timeZone).toBe("America/Los_Angeles");
    expect(result.end.getTime()).toBeGreaterThan(result.start.getTime());
  });

  it("rejects invalid local date range ordering", async () => {
    resetMocks();
    vi.mocked((prisma as any).emailAccount.findUnique).mockResolvedValueOnce({
      timezone: "America/Los_Angeles",
    });
    const result = await resolveCalendarTimeRange({
      userId: "u-1",
      emailAccountId: "e-1",
      defaultWindow: "next_7_days",
      missingBoundDurationMs: 7 * 24 * 60 * 60 * 1000,
      dateRange: {
        after: "2026-02-12T14:00:00",
        before: "2026-02-10T14:00:00",
      },
    });
    expect("error" in result && result.error.includes("Invalid date range")).toBe(
      true,
    );
  });

  it("supports explicit requested timezone and rejects invalid timezone", async () => {
    resetMocks();
    vi.mocked((prisma as any).emailAccount.findUnique).mockResolvedValueOnce({
      timezone: "America/Los_Angeles",
    });
    const valid = await resolveCalendarTimeRange({
      userId: "u-1",
      emailAccountId: "e-1",
      requestedTimeZone: "Europe/London",
      defaultWindow: "next_7_days",
      missingBoundDurationMs: 24 * 60 * 60 * 1000,
      dateRange: {
        after: "2026-02-10T14:00:00",
        before: "2026-02-10T15:00:00",
      },
    });
    if ("error" in valid) throw new Error(valid.error);
    expect(valid.timeZone).toBe("Europe/London");
    expect(valid.start.toISOString()).toBe("2026-02-10T14:00:00.000Z");

    resetMocks();
    vi.mocked((prisma as any).emailAccount.findUnique).mockResolvedValueOnce({
      timezone: "America/Los_Angeles",
    });
    const invalid = await resolveCalendarTimeRange({
      userId: "u-1",
      emailAccountId: "e-1",
      requestedTimeZone: "Mars/Phobos",
      defaultWindow: "today",
      missingBoundDurationMs: 24 * 60 * 60 * 1000,
    });
    expect("error" in invalid).toBe(true);
    if ("error" in invalid) {
      expect(invalid.error).toContain('Invalid timezone "Mars/Phobos"');
    }
  });
});
