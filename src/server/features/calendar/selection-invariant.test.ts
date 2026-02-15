import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/server/lib/__mocks__/prisma";
import {
  ensureCalendarSelectionInvariant,
  isLikelyNoisyCalendar,
} from "./selection-invariant";

vi.mock("@/server/db/client");

describe("selection-invariant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables noisy calendars, enables one user calendar, and repairs selection", async () => {
    prisma.calendarConnection.findMany.mockResolvedValue([
      {
        id: "conn-1",
        provider: "google",
        email: "user@example.com",
        calendars: [
          {
            id: "db-noisy",
            calendarId: "en.usa#holiday@group.v.calendar.google.com",
            name: "Holidays",
            description: null,
            primary: false,
            isEnabled: true,
            createdAt: new Date("2024-01-01T00:00:00.000Z"),
          },
          {
            id: "db-personal",
            calendarId: "user@example.com",
            name: "Danny Wang",
            description: null,
            primary: false,
            isEnabled: false,
            createdAt: new Date("2024-01-02T00:00:00.000Z"),
          },
        ],
      },
    ] as any);
    prisma.taskPreference.findUnique.mockResolvedValue({
      selectedCalendarIds: ["en.usa#holiday@group.v.calendar.google.com"],
    } as any);

    const result = await ensureCalendarSelectionInvariant({
      userId: "user-1",
      emailAccountId: "email-1",
      source: "unit_test",
    });

    expect(prisma.calendar.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.calendar.update).toHaveBeenCalledTimes(1);
    expect(prisma.taskPreference.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      update: { selectedCalendarIds: ["user@example.com"] },
      create: { userId: "user-1", selectedCalendarIds: ["user@example.com"] },
      select: { userId: true },
    });
    expect(result.selectedCalendarIds).toEqual(["user@example.com"]);
    expect(result.changed).toBe(true);
  });

  it("keeps existing valid selection without rewriting preferences", async () => {
    prisma.calendarConnection.findMany.mockResolvedValue([
      {
        id: "conn-1",
        provider: "google",
        email: "user@example.com",
        calendars: [
          {
            id: "db-primary",
            calendarId: "user@example.com",
            name: "Primary",
            description: null,
            primary: true,
            isEnabled: true,
            createdAt: new Date("2024-01-01T00:00:00.000Z"),
          },
        ],
      },
    ] as any);
    prisma.taskPreference.findUnique.mockResolvedValue({
      selectedCalendarIds: ["user@example.com"],
    } as any);

    const result = await ensureCalendarSelectionInvariant({
      userId: "user-1",
      emailAccountId: "email-1",
      source: "unit_test",
    });

    expect(prisma.taskPreference.upsert).not.toHaveBeenCalled();
    expect(prisma.calendar.updateMany).not.toHaveBeenCalled();
    expect(result.selectedCalendarIds).toEqual(["user@example.com"]);
    expect(result.changed).toBe(false);
  });

  it("returns existing selection when there are no connected calendars", async () => {
    prisma.calendarConnection.findMany.mockResolvedValue([]);
    prisma.taskPreference.findUnique.mockResolvedValue({
      selectedCalendarIds: ["kept-calendar"],
    } as any);

    const result = await ensureCalendarSelectionInvariant({
      userId: "user-1",
      emailAccountId: "email-1",
      source: "unit_test",
    });

    expect(result.selectedCalendarIds).toEqual(["kept-calendar"]);
    expect(result.enabledCalendarIds).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it("detects known noisy calendars", () => {
    expect(
      isLikelyNoisyCalendar({
        calendarId: "en.usa#holiday@group.v.calendar.google.com",
        name: "Holidays",
        provider: "google",
      }),
    ).toBe(true);
    expect(
      isLikelyNoisyCalendar({
        calendarId: "user@example.com",
        name: "Personal",
        provider: "google",
      }),
    ).toBe(false);
  });
});
