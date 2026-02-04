/** biome-ignore-all lint/style/noMagicNumbers: test */
import { describe, expect, test, vi } from "vitest";
import { analyzeTool } from "@/server/features/ai/tools/analyze";

vi.mock("@/server/lib/user/get", () => ({
  getEmailAccountWithAi: vi.fn().mockResolvedValue({
    id: "email-account-id",
    email: "user@test.com",
    account: { provider: "google" },
  }),
}));

vi.mock("@/server/db/client", () => ({
  default: {},
}));

const logger = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
};

describe("calendar analyze tool", () => {
  test("suggest_times returns available slots", async () => {
    const providers = {
      calendar: {
        findAvailableSlots: vi.fn().mockResolvedValue([
          {
            start: new Date("2024-05-01T10:00:00Z"),
            end: new Date("2024-05-01T10:30:00Z"),
            score: 0.9,
          },
        ]),
      },
      email: {},
    };

    const result = await analyzeTool.execute(
      {
        resource: "calendar",
        analysisType: "suggest_times",
        options: {
          dateRange: {
            after: "2024-05-01T00:00:00Z",
            before: "2024-05-02T00:00:00Z",
          },
          durationMinutes: 30,
          limit: 1,
        },
      },
      {
        emailAccountId: "email-account-id",
        logger,
        providers,
      } as any,
    );

    expect(result.success).toBe(true);
    expect(result.data.suggestedTimes.length).toBe(1);
  });

  test("find_conflicts returns overlapping events", async () => {
    const providers = {
      calendar: {
        getEvent: vi.fn().mockResolvedValue({
          id: "event-1",
          title: "Primary Event",
          startTime: new Date("2024-05-01T10:00:00Z"),
          endTime: new Date("2024-05-01T11:00:00Z"),
          eventUrl: "https://calendar.google.com",
        }),
        searchEvents: vi.fn().mockResolvedValue([
          {
            id: "event-2",
            title: "Overlapping Event",
            startTime: new Date("2024-05-01T10:30:00Z"),
            endTime: new Date("2024-05-01T11:30:00Z"),
            eventUrl: "https://calendar.google.com",
          },
        ]),
      },
      email: {},
    };

    const result = await analyzeTool.execute(
      {
        resource: "calendar",
        analysisType: "find_conflicts",
        ids: ["event-1"],
      },
      {
        emailAccountId: "email-account-id",
        logger,
        providers,
      } as any,
    );

    expect(result.success).toBe(true);
    expect(result.data.conflicts.length).toBe(1);
    expect(result.data.conflicts[0].conflicts.length).toBe(1);
  });
});
