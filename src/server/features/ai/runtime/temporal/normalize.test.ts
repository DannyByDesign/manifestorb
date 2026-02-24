import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeTemporalRange } from "@/server/features/ai/runtime/temporal/normalize";

const resolveDefaultCalendarTimeZoneMock = vi.hoisted(() => vi.fn());
const resolveCalendarTimeZoneForRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/features/ai/tools/calendar-time", () => ({
  resolveDefaultCalendarTimeZone: resolveDefaultCalendarTimeZoneMock,
  resolveCalendarTimeZoneForRequest: resolveCalendarTimeZoneForRequestMock,
}));

describe("normalizeTemporalRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-24T16:00:00.000Z"));
    resolveDefaultCalendarTimeZoneMock.mockResolvedValue({
      timeZone: "America/Los_Angeles",
    });
    resolveCalendarTimeZoneForRequestMock.mockImplementation(
      ({ requestedTimeZone, defaultTimeZone }) => ({
        timeZone: requestedTimeZone ?? defaultTimeZone,
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves relative today window deterministically in user timezone", async () => {
    const result = await normalizeTemporalRange({
      userId: "user-1",
      emailAccountId: "email-1",
      source: {
        query: "emails from today",
      },
      defaultWindow: "none",
      missingBoundDurationMs: 24 * 60 * 60 * 1_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("relative");
    expect(result.timeZone).toBe("America/Los_Angeles");
    expect(result.start?.toISOString()).toBe("2026-02-24T08:00:00.000Z");
    expect(result.end?.toISOString()).toBe("2026-02-25T07:59:59.999Z");
  });

  it("returns no bounds when no temporal hints exist and defaultWindow is none", async () => {
    const result = await normalizeTemporalRange({
      userId: "user-1",
      emailAccountId: "email-1",
      source: {
        query: "portfolio updates",
      },
      defaultWindow: "none",
      missingBoundDurationMs: 24 * 60 * 60 * 1_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("none");
    expect(result.start).toBeUndefined();
    expect(result.end).toBeUndefined();
  });

  it("resolves this morning with an explicit timezone override", async () => {
    const result = await normalizeTemporalRange({
      userId: "user-1",
      emailAccountId: "email-1",
      source: {
        query: "meetings this morning",
        timeZone: "America/New_York",
      },
      defaultWindow: "none",
      missingBoundDurationMs: 24 * 60 * 60 * 1_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timeZone).toBe("America/New_York");
    expect(result.source).toBe("relative");
    expect(result.start?.toISOString()).toBe("2026-02-24T11:00:00.000Z");
    expect(result.end?.toISOString()).toBe("2026-02-24T16:59:59.999Z");
  });
});
