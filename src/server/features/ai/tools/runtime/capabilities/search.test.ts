import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createSearchCapabilities } from "@/server/features/ai/tools/runtime/capabilities/search";
import { createUnifiedSearchService } from "@/server/features/search/unified/service";

const unifiedQuery = vi.fn();

vi.mock("@/server/features/search/unified/service", () => ({
  createUnifiedSearchService: vi.fn(() => ({
    query: unifiedQuery,
  })),
}));

function buildEnv(options?: { currentMessage?: string }): CapabilityEnvironment {
  return {
    runtime: {
      userId: "user-1",
      emailAccountId: "account-1",
      email: "user@example.com",
      provider: "web",
      currentMessage: options?.currentMessage,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      },
    },
    toolContext: {
      userId: "user-1",
      emailAccountId: "account-1",
      currentMessage: options?.currentMessage,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      },
      providers: {
        email: {} as never,
        calendar: {} as never,
      },
    },
  };
}

describe("search capability semantic query preservation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createUnifiedSearchService).mockReturnValue({
      query: unifiedQuery,
    } as never);
    unifiedQuery.mockResolvedValue({
      items: [],
      counts: { email: 0, calendar: 0, rule: 0, memory: 0 },
      total: 0,
      truncated: false,
    });
  });

  it("uses current user message as query context when args only contain structured constraints", async () => {
    const caps = createSearchCapabilities(
      buildEnv({ currentMessage: "Show me my 10 most recent unread emails" }),
    );

    await caps.query({
      scopes: ["email"],
      mailbox: "inbox",
      unread: true,
      limit: 10,
    });

    expect(unifiedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ["email"],
        mailbox: "inbox",
        query: "Show me my 10 most recent unread emails",
        unread: true,
        limit: 10,
      }),
    );
  });

  it("keeps explicit query when provided", async () => {
    const caps = createSearchCapabilities(
      buildEnv({ currentMessage: "this should not override explicit query" }),
    );

    await caps.query({
      query: "from:alice invoice",
      scopes: ["email"],
      limit: 20,
    });

    expect(unifiedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "from:alice invoice",
      }),
    );
  });
});
