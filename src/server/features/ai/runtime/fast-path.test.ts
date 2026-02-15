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

  if (/\brule|rules|automation|policy\b/u.test(normalized)) {
    return {
      intent: "policy_controls",
      domain: "policy",
      requestedOperation: mutationRe.test(normalized) ? "mixed" : "read",
      complexity: "simple",
      routeProfile: "fast",
      riskLevel: "low",
      confidence: 0.84,
      toolHints: ["group:calendar_policy"],
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
  const toolLookup = new Map<string, RuntimeSession["toolRegistry"][number]>();
  for (const name of [
    "email.searchInbox",
    "calendar.listEvents",
    "policy.listRules",
    "policy.createRule",
  ]) {
    toolLookup.set(name, { toolName: name } as RuntimeSession["toolRegistry"][number]);
  }

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
    toolHarness: {
      builtInTools: [],
      customTools: [],
      toolLookup: new Map(),
    },
    toolRegistry: [],
    toolLookup,
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
      expect(match.args).toEqual({ limit: 1, fetchAll: false, purpose: "lookup" });
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

  it("does not force broad inbox fallback for vague requests", async () => {
    const strict = await matchRuntimeFastPath({
      session: buildSession("inbox status"),
      mode: "strict",
    });
    const recovery = await matchRuntimeFastPath({
      session: buildSession("inbox status"),
      mode: "recovery",
    });

    expect(strict).toBeNull();
    expect(recovery).toBeNull();
  });

  it("routes explicit email count requests to completeness-guarded fast path", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("how many emails do i have in my inbox today?"),
      mode: "strict",
    });

    expect(match?.type).toBe("tool_call");
    if (match?.type === "tool_call") {
      expect(match.toolName).toBe("email.searchInbox");
      expect(match.args).toEqual({
        query: "",
        purpose: "count",
        limit: 5000,
        fetchAll: true,
        dateRange: {
          after: "2026-02-14",
          before: "2026-02-14",
        },
      });
      expect(match.requireCompleteResult).toBe(true);
    }
  });

  it("does not fast-path heuristic attention requests", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("check my inbox, what needs attention"),
      mode: "strict",
    });

    expect(match).toBeNull();
  });

  it("routes simple rule list requests to policy.listRules", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("show me my rules"),
      mode: "strict",
    });

    expect(match?.type).toBe("tool_call");
    if (match?.type === "tool_call") {
      expect(match.toolName).toBe("policy.listRules");
      expect(match.args).toEqual({});
    }
  });

  it("routes rule creation requests to policy.createRule", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("create a rule to archive newsletters"),
      mode: "strict",
    });

    expect(match?.type).toBe("tool_call");
    if (match?.type === "tool_call") {
      expect(match.toolName).toBe("policy.createRule");
      expect(match.args).toEqual({
        input: "create a rule to archive newsletters",
        activate: true,
      });
    }
  });

  it("does not fast-path rule disable requests that rely on plain-English targeting", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("disable the rule for marketing emails"),
      mode: "strict",
    });

    expect(match).toBeNull();
  });

  it("routes sender-scoped email reads with explicit date windows", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("show me emails from Alex today"),
      mode: "strict",
    });

    expect(match?.type).toBe("tool_call");
    if (match?.type === "tool_call") {
      expect(match.toolName).toBe("email.searchInbox");
      expect(match.args).toEqual({
        query: "",
        purpose: "list",
        limit: 100,
        fetchAll: false,
        dateRange: {
          after: "2026-02-14",
          before: "2026-02-14",
        },
        from: "Alex",
      });
    }
  });

  it("does not fast-path sender-scoped email reads without explicit date windows", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("show me emails from Alex"),
      mode: "strict",
    });

    expect(match).toBeNull();
  });

  it("routes next-meeting checks to calendar.listEvents", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("what's my next meeting?"),
      mode: "strict",
    });

    expect(match?.type).toBe("tool_call");
    if (match?.type === "tool_call") {
      expect(match.toolName).toBe("calendar.listEvents");
      expect(match.reason).toBe("calendar_next_meeting");
      expect(match.args).toEqual({
        dateRange: {
          after: "2026-02-14",
          before: "2026-02-21",
        },
        limit: 20,
      });
    }
  });

  it("routes current meeting checks to calendar.listEvents for today", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("am i in a meeting right now?"),
      mode: "strict",
    });

    expect(match?.type).toBe("tool_call");
    if (match?.type === "tool_call") {
      expect(match.toolName).toBe("calendar.listEvents");
      expect(match.reason).toBe("calendar_meeting_now");
      expect(match.args).toEqual({
        dateRange: {
          after: "2026-02-14",
          before: "2026-02-14",
        },
        limit: 50,
      });
    }
  });

  it("skips fast path for conditional chained requests", async () => {
    const match = await matchRuntimeFastPath({
      session: buildSession("if i have meetings tomorrow then move them"),
      mode: "strict",
    });

    expect(match).toBeNull();
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
