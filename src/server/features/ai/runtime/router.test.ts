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
    expect(plan.decisionTimeoutMs).toBe(8_000);
    expect(plan.maxAttempts).toBe(2);
  });

  it("routes simple mutations to planner_standard", async () => {
    const plan = await buildRuntimeRoutingPlan({
      session: buildSession("reschedule my 3pm meeting to tomorrow"),
    });

    expect(plan.lane).toBe("planner_standard");
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
    expect(plan.decisionTimeoutMs).toBe(45_000);
    expect(plan.maxAttempts).toBe(6);
  });
});
