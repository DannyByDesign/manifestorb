import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/lib/user/get", () => ({
  getEmailAccountWithAi: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({
  default: {
    emailAccount: {
      findUnique: vi.fn().mockResolvedValue({ timezone: "America/Los_Angeles" }),
    },
    calendar: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    taskPreference: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

import { queryTool } from "./query";

describe("queryTool calendar timezone consistency", () => {
  it("uses explicit filter.timeZone for parsing and formatting", async () => {
    const searchEvents = vi.fn().mockResolvedValue([
      {
        id: "evt-1",
        title: "Focus Block",
        startTime: new Date("2026-02-10T14:00:00.000Z"),
        endTime: new Date("2026-02-10T15:00:00.000Z"),
        attendees: [{ email: "me@example.com" }],
        description: "",
        location: "",
        eventUrl: "",
        videoConferenceLink: "",
      },
    ]);

    const result = await queryTool.execute(
      {
        resource: "calendar",
        filter: {
          timeZone: "Europe/London",
          dateRange: {
            after: "2026-02-10T14:00:00",
            before: "2026-02-10T15:00:00",
          },
          limit: 5,
        },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        providers: { calendar: { searchEvents } },
      } as any,
    );

    expect(searchEvents).toHaveBeenCalledTimes(1);
    const range = searchEvents.mock.calls[0]?.[1];
    expect(range.start.toISOString()).toBe("2026-02-10T14:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-02-10T15:00:00.000Z");

    const data = (result.data as Array<{ snippet?: string; data?: { timeZone?: string } }>) ?? [];
    expect(data[0]?.snippet).toContain("2:00 PM");
    expect(data[0]?.data?.timeZone).toBe("Europe/London");
  });
});
