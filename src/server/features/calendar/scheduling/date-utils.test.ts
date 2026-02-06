import { describe, it, expect } from "vitest";
import {
  toZonedTime,
  fromZonedTime,
  resolveTimeZoneOrUtc,
  isAmbiguousLocalTime,
  roundDateUp,
  differenceInMinutes,
} from "./date-utils";

describe("date-utils timezone helpers", () => {
  it("round-trips UTC through toZonedTime/fromZonedTime across DST spring-forward", () => {
    const timeZone = "America/Los_Angeles";
    const utc = new Date("2024-03-10T09:30:00.000Z"); // 1:30 AM PST (before DST jump)
    const local = toZonedTime(utc, timeZone);
    const roundTrip = fromZonedTime(local, timeZone);
    expect(roundTrip.toISOString()).toBe(utc.toISOString());
  });

  it("detects ambiguity for DST fall-back local times", () => {
    const timeZone = "America/Los_Angeles";
    const utc = new Date("2024-11-03T09:30:00.000Z"); // 2:30 AM PDT (before fall-back)
    const local = toZonedTime(utc, timeZone);
    const roundTrip = fromZonedTime(local, timeZone);
    expect(isAmbiguousLocalTime(local, timeZone)).toBe(true);
    expect(roundTrip.toISOString()).not.toBe(utc.toISOString());
  });

  it("falls back to UTC when timezone is invalid", () => {
    const result = resolveTimeZoneOrUtc("Not/A_TimeZone");
    expect(result.timeZone).toBe("UTC");
    expect(result.isFallback).toBe(true);
  });

  it("detects ambiguous local time during DST fall-back", () => {
    const timeZone = "America/Los_Angeles";
    const utc = new Date("2024-11-03T08:30:00.000Z");
    const local = toZonedTime(utc, timeZone);
    expect(isAmbiguousLocalTime(local, timeZone)).toBe(true);
  });

  it("rounds dates up to the nearest interval", () => {
    const date = new Date("2024-05-01T10:07:00.000Z");
    const rounded = roundDateUp(date, 30);
    expect(rounded.toISOString()).toBe("2024-05-01T10:30:00.000Z");
  });

  it("computes minute differences", () => {
    const a = new Date("2024-05-01T10:00:00.000Z");
    const b = new Date("2024-05-01T09:30:00.000Z");
    expect(differenceInMinutes(a, b)).toBe(30);
  });
});
