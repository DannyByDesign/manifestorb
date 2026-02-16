import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import { buildRuntimeRoutingPlan } from "@/server/features/ai/runtime/router";
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
    /\b(create|update|edit|change|delete|remove|archive|trash|send|reply|move|label|reschedule|book|cancel|approve|deny)\b/u;
  const deepRe = /\b(if|unless|otherwise|except|only if|and then|followed by|across)\b/u;

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

  if (deepRe.test(normalized)) {
    return {
      intent: "cross_surface_plan",
      domain: "cross_surface",
      requestedOperation: "mixed",
      complexity: "complex",
      routeProfile: "deep",
      riskLevel: "medium",
      confidence: 0.8,
      toolHints: ["group:cross_surface_planning"],
      source: "lexical",
    };
  }

  if (/\binbox|email|thread|message\b/u.test(normalized) && !mutationRe.test(normalized)) {
    return {
      intent: "inbox_read",
      domain: "inbox",
      requestedOperation: "read",
      complexity: "simple",
      routeProfile: "fast",
      riskLevel: "low",
      confidence: 0.84,
      toolHints: ["group:inbox_read"],
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
      confidence: 0.84,
      toolHints: ["group:calendar_read"],
      source: "lexical",
    };
  }

  if (mutationRe.test(normalized)) {
    return {
      intent: normalized.includes("calendar") || normalized.includes("meeting")
        ? "calendar_mutation"
        : "inbox_mutation",
      domain: normalized.includes("calendar") || normalized.includes("meeting") ? "calendar" : "inbox",
      requestedOperation: "mutate",
      complexity: "moderate",
      routeProfile: "standard",
      riskLevel: "medium",
      confidence: 0.8,
      toolHints: [],
      source: "lexical",
    };
  }

  return {
    intent: "general",
    domain: "general",
    requestedOperation: "read",
    complexity: "simple",
    routeProfile: "fast",
    riskLevel: "low",
    confidence: 0.62,
    toolHints: [],
    source: "lexical",
  };
}

function buildSession(message: string): RuntimeSession {
  const toolLookup = new Map<string, RuntimeSession["toolRegistry"][number]>();
  for (const name of [
    "email.searchSent",
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

describe("runtime router", () => {
  beforeEach(() => {
    vi.mocked(resolveDefaultCalendarTimeZone).mockResolvedValue({
      timeZone: "America/Los_Angeles",
      source: "integration",
    });
  });

  it("routes greetings to direct response lane", async () => {
    const plan = await buildRuntimeRoutingPlan({
      session: buildSession("hello"),
    });

    expect(plan.lane).toBe("direct_response");
    expect(plan.nativeMaxSteps).toBe(0);
    expect(plan.fastPathMatch?.type).toBe("respond");
  });

  it("routes first inbox read to macro lane", async () => {
    const plan = await buildRuntimeRoutingPlan({
      session: buildSession("find the first email in my inbox"),
    });

    expect(plan.lane).toBe("macro_tool");
    expect(plan.fastPathMatch?.type).toBe("tool_call");
    if (plan.fastPathMatch?.type === "tool_call") {
      expect(plan.fastPathMatch.toolName).toBe("email.searchInbox");
    }
  });

  it("routes short lookups to planner_fast", async () => {
    const plan = await buildRuntimeRoutingPlan({
      session: buildSession("what should i focus on today"),
    });

    expect(plan.lane).toBe("planner_fast");
    expect(plan.nativeMaxSteps).toBe(4);
    expect(plan.nativeTurnTimeoutMs).toBe(25_000);
    expect(plan.decisionTimeoutMs).toBe(8_000);
    expect(plan.maxAttempts).toBe(2);
  });

  it("routes sent email search requests to fast-path macro lane", async () => {
    const plan = await buildRuntimeRoutingPlan({
      session: buildSession("search my sent emails for 'portfolio review'"),
    });

    expect(plan.lane).toBe("macro_tool");
    expect(plan.fastPathMatch?.type).toBe("tool_call");
    if (plan.fastPathMatch?.type === "tool_call") {
      expect(plan.fastPathMatch.toolName).toBe("email.searchSent");
      expect(plan.fastPathMatch.args).toEqual({
        query: "portfolio review",
        purpose: "list",
        limit: 25,
        fetchAll: false,
      });
    }
  });

  it("routes simple mutations to planner_standard", async () => {
    const plan = await buildRuntimeRoutingPlan({
      session: buildSession("reschedule my 3pm meeting to tomorrow"),
    });

    expect(plan.lane).toBe("planner_standard");
    expect(plan.nativeMaxSteps).toBe(8);
    expect(plan.nativeTurnTimeoutMs).toBe(75_000);
    expect(plan.decisionTimeoutMs).toBe(20_000);
    expect(plan.maxAttempts).toBe(4);
  });

  it("routes complex chained requests to planner_deep", async () => {
    const plan = await buildRuntimeRoutingPlan({
      session: buildSession(
        "if i have meetings tomorrow, move them, email everyone, and then update every related task",
      ),
    });

    expect(plan.lane).toBe("planner_deep");
    expect(plan.nativeMaxSteps).toBe(16);
    expect(plan.nativeTurnTimeoutMs).toBe(165_000);
    expect(plan.decisionTimeoutMs).toBe(45_000);
    expect(plan.maxAttempts).toBe(6);
  });
});
