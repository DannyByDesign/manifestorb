import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { Logger } from "@/server/lib/logger";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeTurnContext } from "@/server/features/ai/runtime/tool-runtime";
import { maybeRunDeterministicCrossSurfaceExecutor } from "@/server/features/ai/runtime/deterministic-cross-surface";
import { createGenerateObject } from "@/server/lib/llms";

vi.mock("@/server/lib/llms", () => ({
  createGenerateObject: vi.fn(),
}));

const mockCreateGenerateObject = vi.mocked(createGenerateObject);

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

function baseSession(params: {
  message: string;
  toolLookup: Map<string, any>;
  turnOverrides?: Partial<RuntimeSession["turn"]>;
}): RuntimeSession {
  return {
    input: {
      provider: "web",
      providerName: "web",
      userId: "user-1",
      emailAccountId: "email-1",
      email: "user@example.com",
      message: params.message,
      logger: testLogger(),
    },
    capabilities: {} as any,
    turn: {
      intent: "cross_surface_plan",
      domain: "cross_surface",
      requestedOperation: "mixed",
      complexity: "complex",
      routeProfile: "deep",
      routeHint: "planner",
      riskLevel: "medium",
      confidence: 0.9,
      toolHints: [],
      source: "compiler_fallback",
      conversationClauses: [],
      taskClauses: [],
      metaConstraints: [],
      needsClarification: false,
      ...params.turnOverrides,
    } as any,
    skillSnapshot: { promptSection: "", selectedSkillIds: [] } as any,
    toolHarness: {
      builtInTools: [],
      customTools: [],
      toolLookup: params.toolLookup,
    },
    toolRegistry: [],
    toolLookup: new Map(),
    artifacts: { approvals: [], interactivePayloads: [] } as any,
    summaries: [],
  } as unknown as RuntimeSession;
}

function baseContext(session: RuntimeSession): RuntimeTurnContext {
  return { session };
}

describe("maybeRunDeterministicCrossSurfaceExecutor (plan-based)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns handled=false when the turn is not eligible (no extra LLM call)", async () => {
    const toolLookup = new Map<string, any>();
    const session = baseSession({
      message: "What time is it?",
      toolLookup,
      turnOverrides: { requestedOperation: "read", complexity: "simple", domain: "general", intent: "general" } as any,
    });

    const result = await maybeRunDeterministicCrossSurfaceExecutor({
      session,
      context: baseContext(session),
      userTimeZone: "America/Los_Angeles",
    });

    expect(result.handled).toBe(false);
    expect(mockCreateGenerateObject).not.toHaveBeenCalled();
  });

  it("executes a compiled plan sequentially via the tool harness", async () => {
    const tool1Execute = vi.fn(async () => ({
      success: true,
      message: "ok",
      data: [{ threadId: "t-1" }],
    }));
    const tool2Execute = vi.fn(async (_rawArgs: unknown) => ({
      success: true,
      message: "ok",
      data: { moved: true },
    }));

    const toolLookup = new Map<string, any>([
      [
        "email.searchInbox",
        {
          name: "email.searchInbox",
          label: "email.searchInbox",
          description: "Search inbox threads",
          inputSchema: z.object({ limit: z.number().int().min(1).max(50) }).strict(),
          execute: tool1Execute,
        },
      ],
      [
        "email.moveThread",
        {
          name: "email.moveThread",
          label: "email.moveThread",
          description: "Move a thread",
          inputSchema: z.object({ threadId: z.string().min(1), folder: z.string().min(1) }).strict(),
          execute: tool2Execute,
        },
      ],
    ]);

    mockCreateGenerateObject.mockImplementation(() => async () => ({
      object: {
        shouldExecute: true,
        steps: [
          { id: "s1", toolName: "email.searchInbox", args: { limit: 1 } },
          {
            id: "s2",
            toolName: "email.moveThread",
            args: { threadId: { $ref: "steps.s1.data[0].threadId" }, folder: "Finance" },
          },
        ],
      },
    }));

    const session = baseSession({
      message: "Move the latest invoice email into Finance",
      toolLookup,
    });

    const result = await maybeRunDeterministicCrossSurfaceExecutor({
      session,
      context: baseContext(session),
      userTimeZone: "America/Los_Angeles",
    });

    expect(mockCreateGenerateObject).toHaveBeenCalledTimes(1);
    expect(result.handled).toBe(true);
    expect(tool1Execute).toHaveBeenCalledTimes(1);
    expect(tool2Execute).toHaveBeenCalledTimes(1);
    expect(tool2Execute.mock.calls[0]?.[0]).toEqual({ threadId: "t-1", folder: "Finance" });
  });

  it("falls back (handled=false) when the plan references a tool not in the admitted tool catalog", async () => {
    const toolLookup = new Map<string, any>([
      [
        "email.searchInbox",
        {
          name: "email.searchInbox",
          label: "email.searchInbox",
          description: "Search inbox threads",
          inputSchema: z.object({ limit: z.number().int().min(1).max(50) }).strict(),
          execute: vi.fn(async () => ({ success: true, message: "ok", data: [] })),
        },
      ],
    ]);

    mockCreateGenerateObject.mockImplementation(() => async () => ({
      object: {
        shouldExecute: true,
        steps: [{ id: "s1", toolName: "calendar.updateEvent", args: { eventId: "e-1" } }],
      },
    }));

    const session = baseSession({
      message: "Move my 1:1",
      toolLookup,
    });

    const result = await maybeRunDeterministicCrossSurfaceExecutor({
      session,
      context: baseContext(session),
      userTimeZone: "America/Los_Angeles",
    });

    expect(result.handled).toBe(false);
  });

  it("falls back (handled=false) when the first step args are invalid", async () => {
    const toolLookup = new Map<string, any>([
      [
        "email.searchInbox",
        {
          name: "email.searchInbox",
          label: "email.searchInbox",
          description: "Search inbox threads",
          inputSchema: z.object({ limit: z.number().int().min(1).max(50) }).strict(),
          execute: vi.fn(async () => ({ success: true, message: "ok", data: [] })),
        },
      ],
    ]);

    mockCreateGenerateObject.mockImplementation(() => async () => ({
      object: {
        shouldExecute: true,
        steps: [{ id: "s1", toolName: "email.searchInbox", args: {} }], // missing required `limit`
      },
    }));

    const session = baseSession({
      message: "Find my emails",
      toolLookup,
    });

    const result = await maybeRunDeterministicCrossSurfaceExecutor({
      session,
      context: baseContext(session),
      userTimeZone: "America/Los_Angeles",
    });

    expect(result.handled).toBe(false);
  });
});
