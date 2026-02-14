import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/server/db/client";
import {
  resolveCalendarTimeRange,
  resolveDefaultCalendarTimeZone,
} from "@/server/features/ai/tools/calendar-time";

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

describe("calendar-time timezone resolution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T02:49:00.000Z")); // Feb 13, 6:49 PM in America/Los_Angeles
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefers connected calendar timezone over email account timezone", async () => {
    vi.mocked(prisma.emailAccount.findUnique).mockResolvedValue({
      timezone: "UTC",
    } as never);
    vi.mocked(prisma.calendar.findFirst)
      .mockResolvedValueOnce({
        timezone: "America/Los_Angeles",
      } as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.taskPreference.findUnique).mockResolvedValue(null as never);

    const resolved = await resolveDefaultCalendarTimeZone({
      userId: "user-1",
      emailAccountId: "acct-1",
    });

    expect(resolved).toEqual({
      timeZone: "America/Los_Angeles",
      source: "integration_primary_calendar",
    });
  });

  it("infers 'today' from hint text in the resolved calendar timezone", async () => {
    vi.mocked(prisma.emailAccount.findUnique).mockResolvedValue({
      timezone: "UTC",
    } as never);
    vi.mocked(prisma.calendar.findFirst)
      .mockResolvedValueOnce({
        timezone: "America/Los_Angeles",
      } as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.taskPreference.findUnique).mockResolvedValue(null as never);

    const range = await resolveCalendarTimeRange({
      userId: "user-1",
      emailAccountId: "acct-1",
      defaultWindow: "next_7_days",
      missingBoundDurationMs: 7 * 24 * 60 * 60 * 1000,
      relativeDateHintText: "today, right now",
    });

    expect("error" in range).toBe(false);
    if ("error" in range) return;
    expect(range.timeZone).toBe("America/Los_Angeles");
    expect(range.start.toISOString()).toBe("2026-02-13T08:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-02-14T07:59:59.999Z");
  });
});
