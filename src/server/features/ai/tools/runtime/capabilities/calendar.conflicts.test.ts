import { describe, expect, it } from "vitest";
import { __test__ as calendarTest } from "@/server/features/ai/tools/runtime/capabilities/calendar";

function ev(params: { id: string; start: string; end: string; allDay?: boolean }) {
  const startMs = Date.parse(params.start);
  const endMs = Date.parse(params.end);
  return {
    id: params.id,
    calendarId: "primary",
    title: params.id,
    start: params.start,
    end: params.end,
    startMs,
    endMs,
    allDay: params.allDay ?? false,
    snippet: null,
  };
}

describe("calendar conflict grouping", () => {
  it("returns no groups when there are no overlaps", () => {
    const groups = calendarTest.computeConflictGroups({
      timeZone: "UTC",
      includeAllDay: false,
      events: [
        ev({ id: "a", start: "2026-02-18T09:00:00.000Z", end: "2026-02-18T10:00:00.000Z" }),
        ev({ id: "b", start: "2026-02-18T10:00:00.000Z", end: "2026-02-18T11:00:00.000Z" }),
      ],
    });
    expect(groups).toEqual([]);
  });

  it("creates one group for a simple overlap", () => {
    const groups = calendarTest.computeConflictGroups({
      timeZone: "UTC",
      includeAllDay: false,
      events: [
        ev({ id: "a", start: "2026-02-18T09:00:00.000Z", end: "2026-02-18T10:30:00.000Z" }),
        ev({ id: "b", start: "2026-02-18T10:00:00.000Z", end: "2026-02-18T11:00:00.000Z" }),
      ],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.events.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("treats transitive overlaps as one conflict group", () => {
    const groups = calendarTest.computeConflictGroups({
      timeZone: "UTC",
      includeAllDay: false,
      events: [
        ev({ id: "a", start: "2026-02-18T09:00:00.000Z", end: "2026-02-18T10:00:00.000Z" }),
        ev({ id: "b", start: "2026-02-18T09:30:00.000Z", end: "2026-02-18T10:30:00.000Z" }),
        ev({ id: "c", start: "2026-02-18T10:15:00.000Z", end: "2026-02-18T11:00:00.000Z" }),
      ],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.events.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("excludes all-day events by default", () => {
    const groups = calendarTest.computeConflictGroups({
      timeZone: "UTC",
      includeAllDay: false,
      events: [
        ev({ id: "allDay", start: "2026-02-18T00:00:00.000Z", end: "2026-02-19T00:00:00.000Z", allDay: true }),
        ev({ id: "meeting", start: "2026-02-18T09:00:00.000Z", end: "2026-02-18T10:00:00.000Z" }),
      ],
    });
    expect(groups).toEqual([]);
  });
});

