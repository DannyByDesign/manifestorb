import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  compileRuntimeTurn,
  runtimeTurnCompilerModelSchema,
} from "@/server/features/ai/runtime/turn-compiler";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
import type { Logger } from "@/server/lib/logger";
import { assertProviderFacingSchemaSafety } from "@/server/lib/llms/schema-safety";

vi.mock("@/server/features/ai/tools/calendar-time", () => ({
  resolveDefaultCalendarTimeZone: vi.fn(),
}));

const mockResolveDefaultCalendarTimeZone =
  resolveDefaultCalendarTimeZone as unknown as {
    mockResolvedValue: (value: { timeZone: string; source: string }) => void;
  };

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
    mockResolveDefaultCalendarTimeZone.mockResolvedValue({
      timeZone: "America/Los_Angeles",
      source: "integration",
    });
  });

  it("routes mixed conversational+task turns to planner when model compiler is unavailable", async () => {
    const turn = await compileRuntimeTurn({
      message:
        "Find all emails in my sent inbox containing invoice attachments from this month. do a fresh search in my sent inbox, not from our conversation memory",
      userId: "user-1",
      email: "user@example.com",
      emailAccountId: "email-1",
      logger: testLogger(),
    });

    expect(turn.routeHint).toBe("planner");
    expect(turn.singleToolCall).toBeUndefined();
    expect(turn.metaConstraints).toEqual(
      expect.arrayContaining(["fresh_search", "not_from_conversation_memory"]),
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

  it("keeps thought-partner prompts in conversation-only lane", async () => {
    const turn = await compileRuntimeTurn({
      message:
        "I need a thought partner. Help me reason through two options and challenge my assumptions.",
      userId: "user-1",
      email: "user@example.com",
      emailAccountId: "email-1",
      logger: testLogger(),
    });

    expect(turn.routeHint).toBe("conversation_only");
    expect(turn.singleToolCall).toBeUndefined();
  });

  it("keeps model schema provider-safe for structured output", () => {
    expect(() =>
      assertProviderFacingSchemaSafety({
        schema: runtimeTurnCompilerModelSchema,
        label: "openworld-turn-compiler",
      }),
    ).not.toThrow();
  });

  it("routes explicit web search requests to single_tool:web.search deterministically", async () => {
    const turn = await compileRuntimeTurn({
      message: "Search the web for bun 1.2.2 release notes",
      userId: "user-1",
      email: "user@example.com",
      emailAccountId: "email-1",
      logger: testLogger(),
    });

    expect(turn.routeHint).toBe("single_tool");
    expect(turn.singleToolCall?.toolName).toBe("web.search");
    expect(turn.singleToolCall?.args).toEqual(
      expect.objectContaining({ query: "bun 1.2.2 release notes" }),
    );
  });

  it("routes indirect time-sensitive web lookups to single_tool:web.search", async () => {
    const turn = await compileRuntimeTurn({
      message: "What's the latest on Nvidia earnings?",
      userId: "user-1",
      email: "user@example.com",
      emailAccountId: "email-1",
      logger: testLogger(),
    });

    expect(turn.routeHint).toBe("single_tool");
    expect(turn.singleToolCall?.toolName).toBe("web.search");
    expect(turn.singleToolCall?.args).toEqual(
      expect.objectContaining({ query: "What's the latest on Nvidia earnings?" }),
    );
  });

  it("does not mis-route inbox searches to web.search", async () => {
    const turn = await compileRuntimeTurn({
      message: "Search my inbox for invoices from last month",
      userId: "user-1",
      email: "user@example.com",
      emailAccountId: "email-1",
      logger: testLogger(),
    });

    expect(turn.singleToolCall?.toolName).not.toBe("web.search");
  });
});
