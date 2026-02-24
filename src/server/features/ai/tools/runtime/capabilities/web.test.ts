import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createWebCapabilities, __testing } from "@/server/features/ai/tools/runtime/capabilities/web";

function buildEnv(): CapabilityEnvironment {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    with: vi.fn(),
    flush: vi.fn(async () => {}),
  };
  logger.with.mockReturnValue(logger);

  return {
    runtime: {
      userId: "user-1",
      emailAccountId: "email-1",
      email: "user@example.com",
      provider: "google",
      logger,
    },
    toolContext: {
      userId: "user-1",
      emailAccountId: "email-1",
      logger,
      providers: {
        email: {} as never,
        calendar: {} as never,
      },
    },
  };
}

function anthropicResponse(content: Array<Record<string, unknown>>): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: () => null,
    },
    json: async () => ({
      id: "msg_123",
      model: "claude-sonnet-4-5",
      content,
      usage: { input_tokens: 10, output_tokens: 20 },
    }),
    text: async () => JSON.stringify({ content }),
  } as Response;
}

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    statusText: body,
    headers: {
      get: () => null,
    },
    text: async () => body,
  } as Response;
}

describe("web capabilities (anthropic)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    __testing.clearCaches();
  });

  afterEach(() => {
    // @ts-expect-error test cleanup
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __testing.clearCaches();
  });

  it("returns setup error when Anthropic key is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("TOOL_WEB_SEARCH_ANTHROPIC_API_KEY", "");

    const caps = createWebCapabilities(buildEnv());
    const result = await caps.search({ query: "test" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("missing_anthropic_api_key");
  });

  it("uses Anthropic web search tool and returns mapped results", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchMock = vi.fn(async () =>
      anthropicResponse([
        {
          type: "text",
          text: "1. Example - https://example.com",
          citations: [{ url: "https://example.com", title: "Example" }],
        },
      ]),
    );
    // @ts-expect-error mock fetch
    global.fetch = fetchMock;

    const caps = createWebCapabilities(buildEnv());
    const result = await caps.search({ query: "markets", count: 3 });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const data = result.data as Record<string, unknown>;
    const results = data.results as Array<Record<string, unknown>>;
    expect(Array.isArray(results)).toBe(true);
    expect(results[0]).toMatchObject({ url: "https://example.com" });
  });

  it("returns cached marker for repeated identical search", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchMock = vi.fn(async () =>
      anthropicResponse([
        {
          type: "text",
          text: "Example https://example.com",
          citations: [{ url: "https://example.com", title: "Example" }],
        },
      ]),
    );
    // @ts-expect-error mock fetch
    global.fetch = fetchMock;

    const caps = createWebCapabilities(buildEnv());
    const first = await caps.search({ query: "cache test" });
    const second = await caps.search({ query: "cache test" });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((second.data as Record<string, unknown>).cached).toBe(true);
  });

  it("returns stale cached search results when provider fails after cache expiry", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("TOOL_WEB_SEARCH_CACHE_TTL_MINUTES", "0.0001");
    vi.stubEnv("TOOL_WEB_SEARCH_RETRY_ATTEMPTS", "1");

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () =>
        anthropicResponse([
          {
            type: "text",
            text: "Example https://example.com",
            citations: [{ url: "https://example.com", title: "Example" }],
          },
        ]),
      )
      .mockImplementationOnce(async () => errorResponse(503, "temporary"));
    // @ts-expect-error mock fetch
    global.fetch = fetchMock;

    const caps = createWebCapabilities(buildEnv());
    const first = await caps.search({ query: "stale cache test" });
    expect(first.success).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = await caps.search({ query: "stale cache test" });
    expect(second.success).toBe(true);
    expect((second.data as Record<string, unknown>).stale).toBe(true);
    expect((second.data as Record<string, unknown>).fallback).toBe("stale_if_error");
  });

  it("uses Anthropic web fetch tool for web.fetch", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchMock = vi.fn(async () =>
      anthropicResponse([
        {
          type: "text",
          text: "Fetched content body",
        },
      ]),
    );
    // @ts-expect-error mock fetch
    global.fetch = fetchMock;

    const caps = createWebCapabilities(buildEnv());
    const result = await caps.fetch({ url: "https://example.com/page", extractMode: "text" });

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.extractor).toBe("anthropic_web_fetch");
    expect(typeof data.content).toBe("string");
    expect((data.content as string).toLowerCase()).toContain("fetched content");
  });
});
