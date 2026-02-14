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

function buildSemanticForTest(message: string): RuntimeSession["semantic"] {
  const normalized = message.toLowerCase();
  const mutationRe =
    /\b(create|update|edit|change|delete|remove|archive|trash|send|reply|move|label|reschedule|book|cancel|block|unsubscribe|mark)\b/u;

  if (/^(hi|hello|hey)\b/u.test(normalized)) {
    return {
      intent: "greeting",
      domain: "general",
      requestedOperation: "meta",
      complexity: "simple",
      routeProfile: "fast",
      riskLevel: "low",
      confidence: 0.9,
      toolHints: [],
      source: "lexical",
    };
  }

  if (/\bwhat can you do\b/u.test(normalized)) {
    return {
      intent: "capabilities",
      domain: "general",
      requestedOperation: "meta",
      complexity: "simple",
      routeProfile: "fast",
      riskLevel: "low",
      confidence: 0.9,
      toolHints: [],
      source: "lexical",
    };
  }

  if (/\bcalendar|meeting|event|schedule\b/u.test(normalized) && !mutationRe.test(normalized)) {
    return {
      intent: "calendar_read",
      domain: "calendar",
      requestedOperation: "read",
      complexity: "simple",
      routeProfile: "fast",
      riskLevel: "low",
      confidence: 0.85,
      toolHints: ["group:calendar_read"],
      source: "lexical",
    };
  }

  if (/\binbox|email|thread|message\b/u.test(normalized) && !mutationRe.test(normalized)) {
    const attention = /\bunread|attention|reply\b/u.test(normalized);
    return {
      intent: attention ? "inbox_attention" : "inbox_read",
      domain: "inbox",
      requestedOperation: "read",
      complexity: "simple",
      routeProfile: "fast",
      riskLevel: "low",
      confidence: 0.85,
      toolHints: ["group:inbox_read"],
      source: "lexical",
    };
  }

  return {
    intent: "general",
    domain: "general",
    requestedOperation: mutationRe.test(normalized) ? "mutate" : "read",
    complexity: mutationRe.test(normalized) ? "moderate" : "simple",
    routeProfile: mutationRe.test(normalized) ? "standard" : "fast",
    riskLevel: mutationRe.test(normalized) ? "medium" : "low",
    confidence: 0.62,
    toolHints: [],
    source: "lexical",
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
    semantic: buildSemanticForTest(message),
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

  it("uses semantic inbox read path even when keyword matching is weak", async () => {
    const strict = await matchRuntimeFastPath({
      session: buildSession("inbox status"),
      mode: "strict",
    });
    const recovery = await matchRuntimeFastPath({
      session: buildSession("inbox status"),
      mode: "recovery",
    });

    expect(strict?.type).toBe("tool_call");
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
