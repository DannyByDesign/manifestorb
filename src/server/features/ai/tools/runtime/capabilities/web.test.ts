import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { createWebCapabilities, __testing } from "@/server/features/ai/tools/runtime/capabilities/web";
import * as ssrf from "@/server/features/ai/tools/runtime/capabilities/web-ssrf";

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

function makeHeaders(map: Record<string, string>): { get: (key: string) => string | null } {
  return {
    get: (key) => map[key.toLowerCase()] ?? null,
  };
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: makeHeaders({ "content-type": "application/json" }),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

function textResponse(body: string, contentType = "text/plain"): Response {
  return {
    ok: true,
    status: 200,
    headers: makeHeaders({ "content-type": contentType }),
    text: async () => body,
  } as Response;
}

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    statusText: body,
    headers: makeHeaders({ "content-type": "application/json" }),
    text: async () => body,
  } as Response;
}

function redirectResponse(location: string): Response {
  return {
    ok: false,
    status: 302,
    headers: makeHeaders({ location }),
    body: { cancel: vi.fn() },
    text: async () => "",
  } as Response;
}

describe("web capabilities", () => {
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

  it("returns setup error when Brave key is missing", async () => {
    vi.stubEnv("TOOL_WEB_SEARCH_PROVIDER", "brave");
    vi.stubEnv("BRAVE_API_KEY", "");
    vi.stubEnv("TOOL_WEB_SEARCH_BRAVE_API_KEY", "");

    const caps = createWebCapabilities(buildEnv());
    const result = await caps.search({ query: "test" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("missing_brave_api_key");
  });

  it("returns setup error when Perplexity key is missing", async () => {
    vi.stubEnv("TOOL_WEB_SEARCH_PROVIDER", "perplexity");
    vi.stubEnv("PERPLEXITY_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("TOOL_WEB_SEARCH_PERPLEXITY_API_KEY", "");

    const caps = createWebCapabilities(buildEnv());
    const result = await caps.search({ query: "test" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("missing_perplexity_api_key");
  });

  it("passes country/search_lang/ui_lang/freshness params to Brave", async () => {
    vi.stubEnv("TOOL_WEB_SEARCH_PROVIDER", "brave");
    vi.stubEnv("BRAVE_API_KEY", "brave-key");
    const fetchMock = vi.fn(async () => jsonResponse({ web: { results: [] } }));
    // @ts-expect-error mock fetch
    global.fetch = fetchMock;

    const caps = createWebCapabilities(buildEnv());
    const result = await caps.search({
      query: "markets",
      country: "US",
      search_lang: "en",
      ui_lang: "en-US",
      freshness: "pw",
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    const parsed = new URL(calledUrl);
    expect(parsed.searchParams.get("country")).toBe("US");
    expect(parsed.searchParams.get("search_lang")).toBe("en");
    expect(parsed.searchParams.get("ui_lang")).toBe("en-US");
    expect(parsed.searchParams.get("freshness")).toBe("pw");
  });

  it("rejects unsupported or invalid freshness values deterministically", async () => {
    vi.stubEnv("TOOL_WEB_SEARCH_PROVIDER", "perplexity");
    vi.stubEnv("PERPLEXITY_API_KEY", "pplx-key");
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: "ok" } }],
        citations: [],
      }),
    );
    // @ts-expect-error mock fetch
    global.fetch = fetchMock;

    const caps = createWebCapabilities(buildEnv());
    const unsupported = await caps.search({ query: "test", freshness: "pw" });

    expect(unsupported.success).toBe(false);
    expect(unsupported.error).toBe("unsupported_freshness");
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("TOOL_WEB_SEARCH_PROVIDER", "brave");
    vi.stubEnv("BRAVE_API_KEY", "brave-key");
    const invalid = await caps.search({ query: "test", freshness: "yesterday" });
    expect(invalid.success).toBe(false);
    expect(invalid.error).toBe("invalid_freshness");
  });

  it("returns cached marker for repeated identical search", async () => {
    vi.stubEnv("TOOL_WEB_SEARCH_PROVIDER", "brave");
    vi.stubEnv("BRAVE_API_KEY", "brave-key");
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        web: {
          results: [{ title: "Example", url: "https://example.com", description: "sample" }],
        },
      }),
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
    vi.stubEnv("TOOL_WEB_SEARCH_PROVIDER", "brave");
    vi.stubEnv("BRAVE_API_KEY", "brave-key");
    vi.stubEnv("TOOL_WEB_SEARCH_CACHE_TTL_MINUTES", "0.0001");
    vi.stubEnv("TOOL_WEB_SEARCH_RETRY_ATTEMPTS", "1");
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () =>
        jsonResponse({
          web: {
            results: [{ title: "Example", url: "https://example.com", description: "cached" }],
          },
        }),
      )
      .mockImplementationOnce(async () => errorResponse(503, '{"error":"temporary"}'));
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

  it("supports staged enrichment by fetching top web results", async () => {
    vi.stubEnv("TOOL_WEB_SEARCH_PROVIDER", "brave");
    vi.stubEnv("BRAVE_API_KEY", "brave-key");
    vi.stubEnv("TOOL_WEB_SEARCH_RETRY_ATTEMPTS", "1");
    const resolveSpy = vi.spyOn(ssrf, "resolvePinnedHostname");
    resolveSpy.mockImplementation(async (hostname: string) => ({
      hostname,
      addresses: ["93.184.216.34"],
      lookup: ssrf.createPinnedLookup({
        hostname,
        addresses: ["93.184.216.34"],
      }),
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.search.brave.com/res/v1/web/search")) {
        return jsonResponse({
          web: {
            results: [
              {
                title: "Example",
                url: "https://example.com/page",
                description: "sample",
              },
            ],
          },
        });
      }
      if (url === "https://example.com/page") {
        return textResponse("<html><body><main>Deep context</main></body></html>", "text/html");
      }
      throw new Error(`unexpected url: ${url}`);
    });
    // @ts-expect-error mock fetch
    global.fetch = fetchMock;

    const caps = createWebCapabilities(buildEnv());
    const result = await caps.search({
      query: "enrichment test",
      enrichTopK: 1,
      enrichExtractMode: "text",
      enrichMaxChars: 1200,
    });

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    const results = data.results as Array<Record<string, unknown>>;
    expect(Array.isArray(results)).toBe(true);
    expect(results[0]?.fetchedPreview).toContain("Deep context");
    expect(data.enrichedCount).toBe(1);
  });

  it("rejects non-http(s) URLs for web.fetch", async () => {
    const caps = createWebCapabilities(buildEnv());
    const result = await caps.fetch({ url: "file:///etc/passwd" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_url_scheme");
  });

  it("blocks localhost/private targets before outbound fetch", async () => {
    const fetchMock = vi.fn(async () => textResponse("ok"));
    // @ts-expect-error mock fetch
    global.fetch = fetchMock;

    const caps = createWebCapabilities(buildEnv());
    const result = await caps.fetch({ url: "http://localhost:8080/private" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("ssrf_blocked");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks redirect chains that jump to private targets", async () => {
    const resolveSpy = vi.spyOn(ssrf, "resolvePinnedHostname");
    resolveSpy.mockImplementation(async (hostname: string) => {
      if (hostname === "public.test") {
        return {
          hostname: "public.test",
          addresses: ["93.184.216.34"],
          lookup: ssrf.createPinnedLookup({
            hostname: "public.test",
            addresses: ["93.184.216.34"],
          }),
        };
      }
      throw new ssrf.SsrfBlockedError("Blocked: private/internal IP address");
    });

    const fetchMock = vi.fn(async () => redirectResponse("http://127.0.0.1/secret"));
    // @ts-expect-error mock fetch
    global.fetch = fetchMock;

    const caps = createWebCapabilities(buildEnv());
    const result = await caps.fetch({ url: "https://public.test/start" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("ssrf_blocked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("extracts normalized content payload for successful fetch", async () => {
    const resolveSpy = vi.spyOn(ssrf, "resolvePinnedHostname");
    resolveSpy.mockImplementation(async (hostname: string) => ({
      hostname,
      addresses: ["93.184.216.34"],
      lookup: ssrf.createPinnedLookup({
        hostname,
        addresses: ["93.184.216.34"],
      }),
    }));

    const html = "<html><head><title>Sample</title></head><body><main><p>Hello world</p></main></body></html>";
    const fetchMock = vi.fn(async () => textResponse(html, "text/html"));
    // @ts-expect-error mock fetch
    global.fetch = fetchMock;

    const caps = createWebCapabilities(buildEnv());
    const result = await caps.fetch({ url: "https://example.com/page", extractMode: "text" });

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.status).toBe(200);
    expect(data.finalUrl).toBe("https://example.com/page");
    expect(typeof data.content).toBe("string");
    expect((data.content as string).toLowerCase()).toContain("hello world");
    expect(["readability", "raw", "firecrawl"]).toContain(String(data.extractor));
  });
});
