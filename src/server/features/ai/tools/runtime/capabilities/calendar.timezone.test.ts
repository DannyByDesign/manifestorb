import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createCalendarCapabilities } from "@/server/features/ai/tools/runtime/capabilities/calendar";
import {
  resolveCalendarTimeRange,
  resolveCalendarTimeZoneForRequest,
  resolveDefaultCalendarTimeZone,
} from "@/server/features/ai/tools/calendar-time";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findCalendarAvailability,
  getCalendarEvent,
  updateCalendarEvent,
} from "@/server/features/ai/tools/calendar/primitives";

const { mockUnifiedQuery } = vi.hoisted(() => ({
  mockUnifiedQuery: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  default: {
    taskPreference: { upsert: vi.fn() },
    emailAccount: { update: vi.fn() },
  },
}));

vi.mock("@/server/features/ai/tools/calendar-time", () => ({
  resolveCalendarTimeRange: vi.fn(),
  resolveCalendarTimeZoneForRequest: vi.fn(),
  resolveDefaultCalendarTimeZone: vi.fn(),
}));

vi.mock("@/server/features/ai/tools/calendar/primitives", () => ({
  createCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  findCalendarAvailability: vi.fn(),
  getCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
}));

vi.mock("@/server/features/search/unified/service", () => ({
  createUnifiedSearchService: vi.fn(() => ({
    query: mockUnifiedQuery,
  })),
}));

function buildEnv(): CapabilityEnvironment {
  return {
    runtime: {
      userId: "user-1",
      emailAccountId: "account-1",
      email: "user@example.com",
      provider: "web",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      },
    },
    toolContext: {
      userId: "user-1",
      emailAccountId: "account-1",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      },
      providers: {
        calendar: {} as never,
        email: {} as never,
      },
    },
  };
}

describe("runtime calendar timezone handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveDefaultCalendarTimeZone).mockResolvedValue({
      timeZone: "America/Los_Angeles",
      source: "integration",
    });
    vi.mocked(resolveCalendarTimeZoneForRequest).mockImplementation(
      ({ requestedTimeZone, defaultTimeZone }) => ({
        timeZone: requestedTimeZone ?? defaultTimeZone,
      }),
    );
    vi.mocked(resolveCalendarTimeRange).mockResolvedValue({
      start: new Date("2026-02-16T08:00:00.000Z"),
      end: new Date("2026-02-17T07:59:59.999Z"),
      timeZone: "America/Los_Angeles",
    });
    mockUnifiedQuery.mockResolvedValue({
      items: [],
      total: 0,
      truncated: false,
    });
    vi.mocked(findCalendarAvailability).mockResolvedValue([]);
    vi.mocked(getCalendarEvent).mockResolvedValue(null);
    vi.mocked(updateCalendarEvent).mockRejectedValue(new Error("not used"));
    vi.mocked(deleteCalendarEvent).mockResolvedValue(undefined);
    vi.mocked(createCalendarEvent).mockResolvedValue({
      id: "evt-1",
      title: "Focus",
      startTime: new Date("2026-02-16T17:00:00.000Z"),
      endTime: new Date("2026-02-16T18:00:00.000Z"),
      attendees: [],
    } as never);
  });

  it("routes listEvents window through calendar timezone resolver", async () => {
    mockUnifiedQuery.mockResolvedValueOnce({
      items: [
        {
          id: "calendar:evt-1",
          surface: "calendar",
          title: "Standup",
          snippet: "Daily sync",
          timestamp: "2026-02-16T17:00:00.000Z",
          score: 0.9,
          metadata: {
            eventId: "evt-1",
            start: "2026-02-16T17:00:00.000Z",
            end: "2026-02-16T17:30:00.000Z",
            attendees: [],
          },
        },
      ],
      total: 1,
      truncated: false,
    });

    const caps = createCalendarCapabilities(buildEnv());
    const result = await caps.listEvents({
      dateRange: { after: "2026-02-16", before: "2026-02-16" },
    });

    expect(resolveCalendarTimeRange).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        emailAccountId: "account-1",
        dateRange: { after: "2026-02-16", before: "2026-02-16" },
      }),
    );
    expect(mockUnifiedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ["calendar"],
        dateRange: {
          after: "2026-02-16T08:00:00.000Z",
          before: "2026-02-17T07:59:59.999Z",
          timeZone: "America/Los_Angeles",
        },
      }),
    );

    const item = Array.isArray(result.data)
      ? (result.data[0] as Record<string, unknown> | undefined)
      : undefined;
    expect(typeof item?.start).toBe("string");
    expect(typeof item?.startLocal).toBe("string");
  });

  it("parses local createEvent datetime in user timezone before provider call", async () => {
    const caps = createCalendarCapabilities(buildEnv());
    await caps.createEvent({
      title: "Focus",
      start: "2026-02-16T09:00",
      end: "2026-02-16T10:00",
    });

    expect(createCalendarEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event: expect.objectContaining({
          timeZone: "America/Los_Angeles",
          start: expect.any(Date),
          end: expect.any(Date),
        }),
      }),
    );
    const callArg = vi.mocked(createCalendarEvent).mock.calls[0]?.[1] as {
      event: { start: Date; end: Date };
    };
    expect(callArg.event.start.toISOString()).toBe("2026-02-16T17:00:00.000Z");
    expect(callArg.event.end.toISOString()).toBe("2026-02-16T18:00:00.000Z");
  });
});
