import { describe, expect, it } from "vitest";
import { parseDateBoundInTimeZone } from "./timezone";

describe("parseDateBoundInTimeZone", () => {
  it("interprets timezone-less local datetime in the provided timezone", () => {
    const parsed = parseDateBoundInTimeZone(
      "2026-02-10T14:00:00",
      "America/Los_Angeles",
      "start",
    );
    expect(parsed?.toISOString()).toBe("2026-02-10T22:00:00.000Z");
  });

  it("uses end-of-day for date-only before bounds", () => {
    const parsed = parseDateBoundInTimeZone(
      "2026-02-10",
      "America/Los_Angeles",
      "end",
    );
    expect(parsed?.toISOString()).toBe("2026-02-11T07:59:59.999Z");
  });
});

