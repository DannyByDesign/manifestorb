import { describe, expect, test, vi } from "vitest";
import { aiGetCalendarAvailability } from "@/features/calendar/ai/availability";
import { getEmailAccount } from "@/__tests__/helpers";
import type { Prisma } from "@/generated/prisma/client";
import { createScopedLogger } from "@/server/lib/logger";
import { makeThread } from "./helpers";

const logger = createScopedLogger("test");
const TIMEOUT = 20_000;
const isAiTest = process.env.RUN_AI_TESTS === "true";

vi.mock("server-only", () => ({}));
vi.mock("@/features/calendar/unified-availability", () => ({
  getUnifiedCalendarAvailability: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({
  default: {
    calendarConnection: {
      findMany: vi.fn(),
    },
  },
}));

describe.runIf(isAiTest)("edge-case: cascade reschedule", () => {
  test(
    "suggests earlier options when a cancellation frees time",
    async () => {
      const prisma = (await import("@/server/db/client")).default;
      vi.mocked(prisma.calendarConnection.findMany).mockResolvedValue([
        {
          id: "conn-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          provider: "google",
          email: "user@test.com",
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: new Date(Date.now() + 3_600_000),
          isConnected: true,
          emailAccountId: "email-account-id",
          calendars: [{ calendarId: "primary", timezone: "UTC", primary: true }],
        },
      ] as unknown as Prisma.CalendarConnectionGetPayload<{
        include: { calendars: { select: { calendarId: true; timezone: true; primary: true } } };
      }>);

      const { getUnifiedCalendarAvailability } = vi.mocked(
        await import("@/features/calendar/unified-availability"),
      );
      getUnifiedCalendarAvailability.mockResolvedValue([
        { start: "2024-04-26T16:00:00Z", end: "2024-04-26T17:00:00Z" },
      ]);

      const messages = makeThread([
        {
          from: "assistant@example.com",
          subject: "Meeting A canceled",
          content: "Meeting A got canceled. That frees 2pm-3pm.",
        },
        {
          from: "assistant@example.com",
          subject: "Meeting B too late",
          content:
            "Meeting B is squeezed late at 6pm, and Meeting C could move earlier.",
        },
      ]);

      const result = await aiGetCalendarAvailability({
        emailAccount: getEmailAccount({
          about: "Prefer to get home by 6pm; afternoon energy peak.",
        }),
        messages,
        logger,
      });

      expect(result).toBeDefined();
      if (result) {
        expect(result.suggestedTimes.length).toBeGreaterThan(0);
        const earliest = result.suggestedTimes
          .map((time) => new Date(time.start).getTime())
          .sort((a, b) => a - b)[0];
        const lateSlot = new Date("2024-04-26T18:00:00Z").getTime();
        expect(earliest).toBeLessThan(lateSlot);
      }
    },
    TIMEOUT,
  );
});
