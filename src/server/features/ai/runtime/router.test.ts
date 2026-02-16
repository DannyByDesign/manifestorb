import { describe, expect, it } from "vitest";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import { buildRuntimeRoutingPlan } from "@/server/features/ai/runtime/router";

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

function buildSession(params: {
  message: string;
  routeHint: RuntimeSession["turn"]["routeHint"];
  singleToolCall?: RuntimeSession["turn"]["singleToolCall"];
  complexity?: RuntimeSession["turn"]["complexity"];
  requestedOperation?: RuntimeSession["turn"]["requestedOperation"];
}) {
  const toolLookup = new Map<string, RuntimeSession["toolRegistry"][number]>();
  for (const name of ["email.searchInbox", "email.searchSent", "calendar.listEvents"]) {
    toolLookup.set(name, { toolName: name } as RuntimeSession["toolRegistry"][number]);
  }

  return {
    input: {
      provider: "slack",
      providerName: "google",
      userId: "user-1",
      emailAccountId: "acct-1",
      email: "user@example.com",
      message: params.message,
      logger: mockLogger(),
    },
    capabilities: {} as RuntimeSession["capabilities"],
    turn: {
      intent: "inbox_read",
      domain: "inbox",
      requestedOperation: params.requestedOperation ?? "read",
      complexity: params.complexity ?? "simple",
      routeProfile: params.complexity === "complex" ? "deep" : params.complexity === "moderate" ? "standard" : "fast",
      routeHint: params.routeHint,
      riskLevel: "low",
      confidence: 0.88,
      toolHints: [],
      source: "compiler_fallback",
      conversationClauses: [],
      taskClauses: [],
      metaConstraints: [],
      needsClarification: false,
      ...(params.singleToolCall ? { singleToolCall: params.singleToolCall } : {}),
    },
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
  } as RuntimeSession;
}

describe("runtime router", () => {
  it("routes conversational turns to conversation_only", async () => {
    const plan = await buildRuntimeRoutingPlan({
      session: buildSession({
        message: "hello",
        routeHint: "conversation_only",
      }),
    });

    expect(plan.lane).toBe("conversation_only");
    expect(plan.nativeMaxSteps).toBe(0);
  });

  it("routes eligible single tool turns to single_tool lane", async () => {
    const plan = await buildRuntimeRoutingPlan({
      session: buildSession({
        message: "find sent emails with invoice attachments this month",
        routeHint: "single_tool",
        singleToolCall: {
          toolName: "email.searchSent",
          args: { hasAttachment: true },
          reason: "email_sent_list",
        },
      }),
    });

    expect(plan.lane).toBe("single_tool");
    expect(plan.singleToolCall?.toolName).toBe("email.searchSent");
  });

  it("falls back to planner when single tool candidate is unavailable", async () => {
    const session = buildSession({
      message: "search sent",
      routeHint: "single_tool",
      singleToolCall: {
        toolName: "email.unknownTool",
        args: {},
        reason: "unknown",
      },
    });
    session.toolLookup.delete("email.searchSent");

    const plan = await buildRuntimeRoutingPlan({ session });

    expect(plan.lane).toBe("planner");
    expect(plan.reason).toContain("tool_unavailable");
  });

  it("uses deep planner profile for complex turns", async () => {
    const plan = await buildRuntimeRoutingPlan({
      session: buildSession({
        message: "if i have meetings then reschedule and email everyone",
        routeHint: "planner",
        complexity: "complex",
        requestedOperation: "mixed",
      }),
    });

    expect(plan.lane).toBe("planner");
    expect(plan.profile).toBe("deep");
    expect(plan.nativeMaxSteps).toBe(16);
  });
});
