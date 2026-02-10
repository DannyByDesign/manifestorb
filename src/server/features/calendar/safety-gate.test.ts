import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/features/calendar/canonical-state", () => ({
  findCalendarEventShadowByIdentity: vi.fn().mockResolvedValue(null),
  resolveCalendarEventPolicy: vi.fn().mockResolvedValue({
    reschedulePolicy: "FLEXIBLE",
    isProtected: false,
    notifyOnAutoMove: true,
    source: "default",
  }),
  upsertCalendarEventShadow: vi.fn().mockResolvedValue({ shadowId: "shadow-1", remapped: false }),
}));

import {
  findCalendarEventShadowByIdentity,
  resolveCalendarEventPolicy,
} from "@/features/calendar/canonical-state";
import { validateCalendarMutationSafety } from "./safety-gate";

describe("validateCalendarMutationSafety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks for recurrence scope when recurring event mode is omitted", async () => {
    const provider = {
      getEvent: vi.fn().mockResolvedValue({
        id: "evt-1",
        provider: "google",
        calendarId: "primary",
        iCalUid: "ical-1",
        seriesMasterId: "series-1",
        title: "Weekly sync",
        startTime: new Date("2026-02-15T17:00:00.000Z"),
        endTime: new Date("2026-02-15T17:30:00.000Z"),
        attendees: [],
      }),
      searchEvents: vi.fn().mockResolvedValue([]),
    };

    const result = await validateCalendarMutationSafety({
      userId: "user-1",
      emailAccountId: "email-1",
      mutation: "reschedule",
      providers: { calendar: provider },
      targetEventId: "evt-1",
      calendarId: "primary",
      proposedStart: new Date("2026-02-15T18:00:00.000Z"),
      proposedEnd: new Date("2026-02-15T18:30:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      clarification: {
        kind: "missing_fields",
      },
    });
  });

  it("blocks slot when overlap hits protected/fixed event", async () => {
    vi.mocked(resolveCalendarEventPolicy)
      .mockResolvedValueOnce({
        reschedulePolicy: "FLEXIBLE",
        isProtected: false,
        notifyOnAutoMove: true,
        source: "default",
      })
      .mockResolvedValueOnce({
        reschedulePolicy: "FIXED",
        isProtected: true,
        notifyOnAutoMove: true,
        source: "rule",
      });

    vi.mocked(findCalendarEventShadowByIdentity).mockResolvedValue({
      id: "shadow-2",
    } as never);

    const provider = {
      getEvent: vi.fn().mockResolvedValue({
        id: "evt-1",
        provider: "google",
        calendarId: "primary",
        title: "1:1",
        startTime: new Date("2026-02-15T17:00:00.000Z"),
        endTime: new Date("2026-02-15T17:30:00.000Z"),
        attendees: [],
      }),
      searchEvents: vi.fn().mockResolvedValue([
        {
          id: "evt-protected",
          provider: "google",
          calendarId: "primary",
          title: "Focus Block",
          startTime: new Date("2026-02-15T18:00:00.000Z"),
          endTime: new Date("2026-02-15T18:30:00.000Z"),
          attendees: [],
        },
      ]),
    };

    const result = await validateCalendarMutationSafety({
      userId: "user-1",
      emailAccountId: "email-1",
      mutation: "reschedule",
      providers: { calendar: provider },
      targetEventId: "evt-1",
      calendarId: "primary",
      mode: "single",
      proposedStart: new Date("2026-02-15T18:00:00.000Z"),
      proposedEnd: new Date("2026-02-15T18:30:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      error: expect.stringContaining("protected"),
    });
  });
});
