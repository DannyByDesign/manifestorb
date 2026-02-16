import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma, { resetPrismaMock } from "@/server/lib/__mocks__/prisma";
import { hydrateRuntimeContext } from "@/server/features/ai/runtime/context/hydrator";
import { ContextManager } from "@/server/features/memory/context-manager";

vi.mock("@/server/db/client");
vi.mock("@/server/features/memory/context-manager", () => ({
  ContextManager: {
    buildContextPack: vi.fn(),
  },
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
  } as any;
}

describe("runtime context hydrator", () => {
  beforeEach(() => {
    resetPrismaMock();
    vi.clearAllMocks();
  });

  it("returns ready context and stats when context pack build succeeds", async () => {
    prisma.emailAccount.findFirst.mockResolvedValue({
      id: "email-1",
      userId: "user-1",
      email: "u@example.com",
      about: null,
    } as never);

    vi.mocked(ContextManager.buildContextPack).mockResolvedValue({
      system: {
        basePrompt: "",
        safetyGuardrails: [],
        summary: "User likes concise replies",
      },
      facts: [{ id: "f-1", key: "contact_ceo", value: "Sam", confidence: 1 }],
      knowledge: [{ id: "k-1", title: "Partner", content: "Met at summit" }],
      history: [{ id: "m-1", role: "user", content: "Ping Sam", createdAt: new Date() }],
      documents: [],
      pendingState: { approvals: [{ id: "a-1", tool: "send", description: "Send", argsSummary: "" }] },
      attentionItems: [{
        id: "att-1",
        type: "unread_email",
        urgency: "high",
        title: "Reply needed",
        description: "Follow up",
        actionable: true,
      }],
    } as never);

    const result = await hydrateRuntimeContext({
      provider: "web",
      providerName: "google",
      userId: "user-1",
      emailAccountId: "email-1",
      email: "u@example.com",
      message: "  remind me what we discussed with sam  ",
      logger: testLogger(),
    });

    expect(result.message).toBe("remind me what we discussed with sam");
    expect(result.contextStatus).toBe("ready");
    expect(result.contextStats.facts).toBe(1);
    expect(result.contextStats.knowledge).toBe(1);
    expect(result.contextStats.history).toBe(1);
    expect(result.contextStats.attentionItems).toBe(1);
    expect(result.contextStats.hasSummary).toBe(true);
    expect(result.contextStats.hasPendingState).toBe(true);
  });

  it("returns missing context when email account cannot be resolved", async () => {
    prisma.emailAccount.findFirst.mockResolvedValue(null);

    const result = await hydrateRuntimeContext({
      provider: "web",
      providerName: "google",
      userId: "user-1",
      emailAccountId: "missing",
      email: "u@example.com",
      message: "hello",
      logger: testLogger(),
    });

    expect(result.contextStatus).toBe("missing");
    expect(result.contextIssues).toContain("email_account_not_found");
    expect(result.contextPack).toBeUndefined();
  });

  it("degrades gracefully when context build fails", async () => {
    const logger = testLogger();

    prisma.emailAccount.findFirst.mockResolvedValue({
      id: "email-1",
      userId: "user-1",
      email: "u@example.com",
      about: null,
    } as never);

    vi.mocked(ContextManager.buildContextPack).mockRejectedValue(new Error("db unavailable"));

    const result = await hydrateRuntimeContext({
      provider: "web",
      providerName: "google",
      userId: "user-1",
      emailAccountId: "email-1",
      email: "u@example.com",
      message: "hello",
      logger,
    });

    expect(result.contextStatus).toBe("degraded");
    expect(result.contextIssues).toContain("context_hydration_failed");
    expect(logger.warn).toHaveBeenCalled();
  });
});
