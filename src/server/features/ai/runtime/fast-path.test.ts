import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import { matchRuntimeFastPath } from "@/server/features/ai/runtime/fast-path";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";

vi.mock("@/server/features/ai/tools/calendar-time", () => ({
  resolveDefaultCalendarTimeZone: vi.fn(),
}));

function mockLogger() {
  const noop = () => {};
  return {
    info: noop,
    warn: noop,
    error: noop,
    trace: noop,
    with: () => mockLogger(),
    flush: () => Promise.resolve(),
  };
}

function buildSession(message: string): RuntimeSession {
  return {
    input: {
      provider: "slack",
      providerName: "google",
      userId: "user-1",
      emailAccountId: "acct-1",
      email: "user@example.com",
      message,
      logger: mockLogger(),
    },
    capabilities: {} as RuntimeSession["capabilities"],
    skillSnapshot: {
      selectedSkillIds: [],
      promptSection: "",
    },
    tools: {} as RuntimeSession["tools"],
    toolRegistry: [],
    toolLookup: new Map(),
    artifacts: {
      approvals: [],
      interactivePayloads: [],
    },
    summaries: [],
  };
}

describe("runtime fast path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T18:00:00.000Z"));
    vi.mocked(resolveDefaultCalendarTimeZone).mockResolvedValue({
      timeZone: "America/Los_Angeles",
      source: "integration",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("responds directly to greetings", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("hello"),
      mode: "strict",
    });

    expect(match?.type).toBe("respond");
    expect(match?.reason).toBe("greeting");
  });

  it("answers capability questions without planner", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("what can you do for me"),
      mode: "strict",
    });

    expect(match?.type).toBe("respond");
    expect(match?.reason).toBe("capabilities");
    if (match?.type === "respond") {
      expect(match.text.toLowerCase()).toContain("inbox");
      expect(match.text.toLowerCase()).toContain("calendar");
    }
  });

  it("routes first/latest inbox reads to email.searchInbox", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("find me the first email in my inbox right now"),
      mode: "strict",
    });

    expect(match?.type).toBe("tool_call");
    if (match?.type === "tool_call") {
      expect(match.toolName).toBe("email.searchInbox");
      expect(match.args).toEqual({ limit: 1, fetchAll: false });
    }
  });

  it("routes meeting lookups to calendar.listEvents with a day window", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("what meetings do i have today?"),
      mode: "strict",
    });

    expect(match?.type).toBe("tool_call");
    if (match?.type === "tool_call") {
      expect(match.toolName).toBe("calendar.listEvents");
      expect(match.args).toEqual({
        dateRange: {
          after: "2026-02-14",
          before: "2026-02-14",
        },
        limit: 20,
      });
    }
  });

  it("uses safe recovery read path when strict matching misses", async () => {
    const strict = await matchRuntimeFastPath({
      session: buildSession("inbox status"),
      mode: "strict",
    });
    const recovery = await matchRuntimeFastPath({
      session: buildSession("inbox status"),
      mode: "recovery",
    });

    expect(strict).toBeNull();
    expect(recovery?.type).toBe("tool_call");
    if (recovery?.type === "tool_call") {
      expect(recovery.toolName).toBe("email.searchInbox");
    }
  });

  it("asks for concrete target on ambiguous mutation during recovery", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("reschedule everything"),
      mode: "recovery",
    });

    expect(match?.type).toBe("respond");
    expect(match?.reason).toBe("recovery_mutation_clarify");
  });
});
