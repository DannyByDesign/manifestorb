import { describe, it, expect, vi } from "vitest";
import { createCalendarProvider } from "./calendar";

const mockProvider = {
  provider: "google" as const,
  fetchEvents: vi.fn(),
  getEvent: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
};

vi.mock("@/features/calendar/event-provider", () => ({
  createCalendarEventProviders: vi.fn().mockResolvedValue([mockProvider]),
}));

vi.mock("@/server/db/client", () => ({
  default: {
    calendar: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    taskPreference: {
      findUnique: vi.fn(),
    },
  },
}));

describe("createCalendarProvider", () => {
  it("throws when calendarId does not belong to account", async () => {
    const prisma = (await import("@/server/db/client")).default as any;
    prisma.calendar.findFirst.mockResolvedValue(null);

    const provider = await createCalendarProvider(
      { id: "email-account-1" },
      "user-1",
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), with: vi.fn().mockReturnThis() } as any,
    );

    await expect(
      provider.getEvent({ eventId: "evt-1", calendarId: "calendar-1" }),
    ).rejects.toThrow("Calendar not found for account");
  });
});
