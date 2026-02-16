import { describe, expect, it, vi } from "vitest";
import { emitToolLifecycleEvents } from "@/server/features/ai/runtime/harness/tool-events";
import { emitRuntimeTelemetry } from "@/server/features/ai/runtime/telemetry/schema";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";

vi.mock("@/server/features/ai/runtime/telemetry/schema", () => ({
  emitRuntimeTelemetry: vi.fn(),
}));

function buildSession(): RuntimeSession {
  return {
    input: {
      provider: "slack",
      providerName: "google",
      userId: "user-1",
      emailAccountId: "acct-1",
      email: "user@example.com",
      message: "latest email",
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        trace: () => {},
        with: () => ({}),
        flush: async () => {},
      } as never,
    },
    capabilities: {} as RuntimeSession["capabilities"],
    turn: {
      intent: "inbox_read",
      domain: "inbox",
      requestedOperation: "read",
      complexity: "simple",
      routeHint: "single_tool",
      routeProfile: "fast",
      riskLevel: "low",
      confidence: 0.9,
      toolHints: [],
      source: "compiler_fallback",
      conversationClauses: [],
      taskClauses: [],
      metaConstraints: [],
      needsClarification: false,
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
    toolLookup: new Map(),
    artifacts: {
      approvals: [],
      interactivePayloads: [],
    },
    summaries: [],
  };
}

describe("tool lifecycle events", () => {
  it("emits start/update/result with same toolCallId", () => {
    const session = buildSession();
    emitToolLifecycleEvents({
      session,
      steps: [
        {
          toolCalls: [
            {
              toolCallId: "call-1",
              toolName: "email.searchInbox",
              input: { limit: 1 },
            },
          ],
          toolResults: [
            {
              toolCallId: "call-1",
              toolName: "email.searchInbox",
              output: { success: true },
            },
          ],
        } as never,
      ],
    });

    const calls = vi.mocked(emitRuntimeTelemetry).mock.calls
      .filter(([, event]) => event === "openworld.runtime.tool_lifecycle")
      .map(([, , payload]) => payload as Record<string, unknown>);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.phase).toBe("start");
    expect(calls[1]?.phase).toBe("update");
    expect(calls[2]?.phase).toBe("result");
    expect(calls.every((entry) => entry.toolCallId === "call-1")).toBe(true);
  });
});
