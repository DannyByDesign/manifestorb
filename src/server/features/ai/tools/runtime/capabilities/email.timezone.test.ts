import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createEmailCapabilities } from "@/server/features/ai/tools/runtime/capabilities/email";
import {
  resolveCalendarTimeZoneForRequest,
  resolveDefaultCalendarTimeZone,
} from "@/server/features/ai/tools/calendar-time";
import { searchEmailThreads } from "@/server/features/ai/tools/email/primitives";

vi.mock("@/server/features/ai/tools/calendar-time", () => ({
  resolveCalendarTimeZoneForRequest: vi.fn(),
  resolveDefaultCalendarTimeZone: vi.fn(),
}));

vi.mock("@/server/features/ai/tools/email/primitives", () => ({
  getEmailMessages: vi.fn(),
  getEmailThread: vi.fn(),
  modifyEmailMessages: vi.fn(),
  searchEmailThreads: vi.fn(),
  trashEmailMessages: vi.fn(),
}));

function buildEnv(): CapabilityEnvironment {
  return {
    runtime: {
      userId: "user-1",
      emailAccountId: "account-1",
      email: "user@example.com",
      provider: "web",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      },
    },
    toolContext: {
      userId: "user-1",
      emailAccountId: "account-1",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      },
      providers: {
        email: {} as never,
        calendar: {} as never,
      },
    },
  };
}

describe("runtime email timezone handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveDefaultCalendarTimeZone).mockResolvedValue({
      timeZone: "America/Los_Angeles",
      source: "integration",
    });
    vi.mocked(resolveCalendarTimeZoneForRequest).mockImplementation(
      ({ requestedTimeZone, defaultTimeZone }) => ({
        timeZone: requestedTimeZone ?? defaultTimeZone,
      }),
    );
    vi.mocked(searchEmailThreads).mockResolvedValue({
      messages: [],
      nextPageToken: undefined,
      totalEstimate: 0,
    });
  });

  it("parses date-only search bounds in the user's integration timezone", async () => {
    const caps = createEmailCapabilities(buildEnv());
    await caps.searchThreads({
      query: "inbox",
      dateRange: {
        after: "2026-02-16",
        before: "2026-02-16",
      },
    });

    expect(searchEmailThreads).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.any(Date),
        before: expect.any(Date),
      }),
    );

    const filter = vi.mocked(searchEmailThreads).mock.calls[0]?.[1] as {
      after?: Date;
      before?: Date;
    };
    expect(filter.after?.toISOString()).toBe("2026-02-16T08:00:00.000Z");
    expect(filter.before?.toISOString()).toBe("2026-02-17T07:59:59.999Z");
  });
});

