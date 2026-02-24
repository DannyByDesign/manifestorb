import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createCalendarCapabilities } from "@/server/features/ai/tools/runtime/capabilities/calendar";
import { Prisma } from "@/generated/prisma/client";

const resolveDefaultCalendarTimeZoneMock = vi.hoisted(() => vi.fn());
const resolveCalendarTimeRangeMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/features/ai/tools/calendar-time", () => ({
  resolveDefaultCalendarTimeZone: resolveDefaultCalendarTimeZoneMock,
  resolveCalendarTimeRange: resolveCalendarTimeRangeMock,
  resolveCalendarTimeZoneForRequest: vi.fn().mockImplementation(({ defaultTimeZone }) => ({
    timeZone: defaultTimeZone,
  })),
}));

const getCalendarEventMock = vi.hoisted(() => vi.fn());
const updateCalendarEventMock = vi.hoisted(() => vi.fn());
const deleteCalendarEventMock = vi.hoisted(() => vi.fn());
const createCalendarEventMock = vi.hoisted(() => vi.fn());
const pendingIdempotencyCreateMock = vi.hoisted(() => vi.fn());
const pendingIdempotencyFindUniqueMock = vi.hoisted(() => vi.fn());
const pendingIdempotencyUpdateMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/features/ai/tools/calendar/primitives", () => ({
  createCalendarEvent: createCalendarEventMock,
  deleteCalendarEvent: deleteCalendarEventMock,
  findCalendarAvailability: vi.fn(),
  getCalendarEvent: getCalendarEventMock,
  updateCalendarEvent: updateCalendarEventMock,
}));

vi.mock("@/server/db/client", () => ({
  default: {
    pendingAgentTurnState: {
      create: pendingIdempotencyCreateMock,
      findUnique: pendingIdempotencyFindUniqueMock,
      update: pendingIdempotencyUpdateMock,
    },
    calendarConnection: { findMany: vi.fn().mockResolvedValue([]) },
    calendar: { updateMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    taskPreference: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
  },
}));

function buildEnv(): CapabilityEnvironment {
  return {
    runtime: {
      userId: "user-1",
      emailAccountId: "email-1",
      email: "user@example.com",
      provider: "web",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      } as never,
    },
    toolContext: {
      userId: "user-1",
      emailAccountId: "email-1",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      } as never,
      providers: {
        email: {} as never,
        calendar: {
          searchEvents: vi.fn().mockResolvedValue([]),
        } as never,
      },
    } as never,
  };
}

describe("calendar mutation reliability repros", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveDefaultCalendarTimeZoneMock.mockResolvedValue({
      timeZone: "America/Los_Angeles",
    });
    resolveCalendarTimeRangeMock.mockResolvedValue({
      start: new Date("2026-02-24T00:00:00.000Z"),
      end: new Date("2026-02-25T00:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    });
    getCalendarEventMock.mockResolvedValue({
      id: "evt-1",
      seriesMasterId: "series-1",
      title: "Weekly sync",
      startTime: new Date("2026-02-24T18:00:00.000Z"),
      endTime: new Date("2026-02-24T18:30:00.000Z"),
      attendees: [],
    });
    updateCalendarEventMock.mockResolvedValue({
      id: "evt-1",
      title: "Weekly sync",
      startTime: new Date("2026-02-24T19:00:00.000Z"),
      endTime: new Date("2026-02-24T19:30:00.000Z"),
      attendees: [],
    });
    createCalendarEventMock.mockResolvedValue({
      id: "evt-2",
      title: "Focus block",
      startTime: new Date("2026-02-24T20:00:00.000Z"),
      endTime: new Date("2026-02-24T20:30:00.000Z"),
      attendees: [],
    });
    deleteCalendarEventMock.mockResolvedValue(undefined);
    pendingIdempotencyCreateMock.mockResolvedValue({
      id: "idem-row-1",
      correlationId: "idem-key-1",
      status: "PENDING",
      payload: {},
    } as never);
    pendingIdempotencyFindUniqueMock.mockResolvedValue(null as never);
    pendingIdempotencyUpdateMock.mockResolvedValue({
      id: "idem-row-1",
      correlationId: "idem-key-1",
      status: "RESOLVED",
      payload: {},
    } as never);
  });

  it("repro: recurring single-instance update should require explicit instance identity", async () => {
    const caps = createCalendarCapabilities(buildEnv());
    const result = await caps.updateEvent({
      eventId: "evt-1",
      changes: {
        mode: "single",
        start: "2026-02-24T12:00:00",
        end: "2026-02-24T12:30:00",
      },
    });

    expect(result.success).toBe(false);
    expect(result.clarification?.missingFields).toEqual([
      "changes.instanceId_or_originalStartTime",
    ]);
    expect(updateCalendarEventMock).not.toHaveBeenCalled();
  });

  it("repro: recurring single-instance delete should require explicit instance identity", async () => {
    const caps = createCalendarCapabilities(buildEnv());
    const result = await caps.deleteEvent({
      eventId: "evt-1",
      mode: "single",
    });

    expect(result.success).toBe(false);
    expect(result.clarification?.missingFields).toEqual([
      "instanceId_or_originalStartTime",
    ]);
    expect(deleteCalendarEventMock).not.toHaveBeenCalled();
  });

  it("repro: duplicate createEvent retries should replay deterministic outcome", async () => {
    const caps = createCalendarCapabilities(buildEnv());
    const first = await caps.createEvent({
      title: "Focus block",
      start: "2026-02-24T12:00:00",
      end: "2026-02-24T12:30:00",
    });

    pendingIdempotencyCreateMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        clientVersion: "test",
        code: "P2002",
      }),
    );
    pendingIdempotencyFindUniqueMock.mockResolvedValueOnce({
      id: "idem-row-1",
      correlationId: "idem-key-1",
      status: "RESOLVED",
      payload: {
        toolResult: first,
      },
    } as never);

    const replay = await caps.createEvent({
      title: "Focus block",
      start: "2026-02-24T12:00:00",
      end: "2026-02-24T12:30:00",
    });

    expect(createCalendarEventMock).toHaveBeenCalledTimes(1);
    expect(replay.success).toBe(true);
    expect(replay.data).toMatchObject({
      idempotency: expect.objectContaining({
        replayed: true,
      }),
    });
  });
});
