import { beforeEach, describe, expect, it, vi } from "vitest";
import { compileRuntimeTurn } from "@/server/features/ai/runtime/turn-compiler";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
import type { Logger } from "@/server/lib/logger";

vi.mock("@/server/features/ai/tools/calendar-time", () => ({
  resolveDefaultCalendarTimeZone: vi.fn(),
}));

function testLogger() {
  return {
    trace: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    with: vi.fn(),
    flush: vi.fn(),
  } as unknown as Logger;
}

describe("runtime turn compiler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveDefaultCalendarTimeZone).mockResolvedValue({
      timeZone: "America/Los_Angeles",
      source: "integration",
    });
  });

  it("routes mixed conversational+task sent-inbox requests to single-tool email search", async () => {
    const turn = await compileRuntimeTurn({
      message:
        "Find all emails in my sent inbox containing invoice attachments from this month. do a fresh search in my sent inbox, not from our conversation memory",
      userId: "user-1",
      email: "user@example.com",
      emailAccountId: "email-1",
      logger: testLogger(),
    });

    expect(turn.routeHint).toBe("single_tool");
    expect(turn.singleToolCall?.toolName).toBe("email.searchSent");
    expect(turn.metaConstraints).toEqual(
      expect.arrayContaining(["fresh_search", "not_from_conversation_memory"]),
    );

    const args = (turn.singleToolCall?.args ?? {}) as Record<string, unknown>;
    expect(args.from).toBeUndefined();
    expect(args.hasAttachment).toBe(true);
    expect(args.dateRange).toEqual(
      expect.objectContaining({
        after: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        before: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it("keeps simple greetings in conversation-only lane", async () => {
    const turn = await compileRuntimeTurn({
      message: "hello",
      userId: "user-1",
      email: "user@example.com",
      emailAccountId: "email-1",
      logger: testLogger(),
    });

    expect(turn.routeHint).toBe("conversation_only");
    expect(turn.singleToolCall).toBeUndefined();
  });
});
