import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/lib/user/get", () => ({
  getEmailAccountWithAi: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({
  default: {
    emailAccount: {
      findUnique: vi.fn().mockResolvedValue({ timezone: "UTC" }),
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

describe("queryTool calendar attendee filtering", () => {
  it("filters calendar events by attendeeEmail and applies limit", async () => {
    const searchEvents = vi.fn().mockResolvedValue([
      {
        id: "evt-1",
        title: "A",
        startTime: new Date("2026-02-01T10:00:00.000Z"),
        endTime: new Date("2026-02-01T11:00:00.000Z"),
        attendees: [{ email: "target@example.com" }],
      },
      {
        id: "evt-2",
        title: "B",
        startTime: new Date("2026-02-01T12:00:00.000Z"),
        endTime: new Date("2026-02-01T13:00:00.000Z"),
        attendees: [{ email: "other@example.com" }],
      },
      {
        id: "evt-3",
        title: "C",
        startTime: new Date("2026-02-01T14:00:00.000Z"),
        endTime: new Date("2026-02-01T15:00:00.000Z"),
        attendees: [{ email: "target@example.com" }],
      },
    ]);

    const result = await queryTool.execute(
      {
        resource: "calendar",
        filter: {
          attendeeEmail: "target@example.com",
          limit: 1,
          dateRange: {
            after: "2026-02-01T00:00:00.000Z",
            before: "2026-02-02T00:00:00.000Z",
          },
        },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        providers: { calendar: { searchEvents } },
      } as any,
    );

    expect(searchEvents).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect((result.data as any[]).length).toBe(1);
    expect((result.data as any[])[0]?.id).toBe("evt-1");
  });
});
