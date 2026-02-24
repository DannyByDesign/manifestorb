import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import type { ToolResult } from "@/server/features/ai/tools/types";
import { computeExponentialBackoffDelay } from "@/server/features/ai/tools/common/backoff";
import { capTimeoutToRuntimeBudget } from "@/server/features/ai/runtime/deadline-context";
import { sleep } from "@/server/lib/sleep";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  insertedAt: number;
};

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION_HEADER = "2023-06-01";
const ANTHROPIC_WEB_SEARCH_DOCS_URL =
  "https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/web-search-tool";
const ANTHROPIC_WEB_FETCH_DOCS_URL =
  "https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/web-fetch-tool";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";
const DEFAULT_ANTHROPIC_WEB_SEARCH_TOOL = "web_search_20260209";
const FALLBACK_ANTHROPIC_WEB_SEARCH_TOOL = "web_search_20250305";
const DEFAULT_ANTHROPIC_WEB_FETCH_TOOL = "web_fetch_20260209";
const FALLBACK_ANTHROPIC_WEB_FETCH_TOOL = "web_fetch_20250910";

const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_CACHE_TTL_MINUTES = 15;
const DEFAULT_SEARCH_RETRY_ATTEMPTS = 3;
const DEFAULT_SEARCH_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;
const DEFAULT_FETCH_MAX_CHARS = 50_000;
const DEFAULT_ERROR_MAX_CHARS = 4_000;

const SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();
const FETCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

export interface WebCapabilities {
  search(input: {
    query: string;
    count?: number;
    country?: string;
    search_lang?: string;
    ui_lang?: string;
    freshness?: string;
    enrichTopK?: number;
    enrichExtractMode?: "markdown" | "text";
    enrichMaxChars?: number;
  }): Promise<ToolResult>;
  fetch(input: {
    url: string;
    extractMode?: "markdown" | "text";
    maxChars?: number;
  }): Promise<ToolResult>;
}

type SearchSettings = {
  enabled: boolean;
  maxResults: number;
  timeoutSeconds: number;
  cacheTtlMs: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
  anthropicApiKey?: string;
  anthropicModel: string;
  toolType: string;
  fallbackToolType: string;
};

type FetchSettings = {
  enabled: boolean;
  maxChars: number;
  timeoutSeconds: number;
  cacheTtlMs: number;
  anthropicApiKey?: string;
  anthropicModel: string;
  toolType: string;
  fallbackToolType: string;
};

type AnthropicContentBlock = {
  type?: string;
  text?: string;
  citations?: unknown;
  [key: string]: unknown;
};

type AnthropicMessageResponse = {
  id?: string;
  model?: string;
  content?: AnthropicContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

type AnthropicCitation = {
  url: string;
  title?: string;
};

class AnthropicHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "AnthropicHttpError";
  }
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveTimeoutSeconds(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.floor(parsed));
}

function resolveCacheTtlMs(value: unknown, fallbackMinutes: number): number {
  const minutes =
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallbackMinutes;
  return Math.round(minutes * 60_000);
}

function normalizeCacheKey(value: string): string {
  return value.trim().toLowerCase();
}

function readCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
): { value: T; cached: boolean } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return { value: entry.value, cached: true };
}

function writeCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
): void {
  if (ttlMs <= 0) return;
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    insertedAt: Date.now(),
  });
}

function getExpiredCacheValue(
  cache: Map<string, CacheEntry<Record<string, unknown>>>,
  key: string,
): { value: Record<string, unknown>; staleAgeMs: number } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  const staleAgeMs = Date.now() - entry.expiresAt;
  if (staleAgeMs <= 0) return null;
  return {
    value: entry.value,
    staleAgeMs,
  };
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (timeoutMs <= 0) return signal ?? new AbortController().signal;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        controller.abort();
      },
      { once: true },
    );
  }
  controller.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
    },
    { once: true },
  );
  return controller.signal;
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function resolveTimeoutSecondsWithRuntimeBudget(params: {
  timeoutSeconds: number;
  reserveMs: number;
}): number {
  const requestedMs = Math.max(1_000, Math.floor(params.timeoutSeconds * 1000));
  const cappedMs = capTimeoutToRuntimeBudget({
    requestedMs,
    minimumMs: 1_000,
    reserveMs: params.reserveMs,
  });
  return Math.max(1, Math.floor(cappedMs / 1000));
}

function resolveSearchCount(value: unknown, fallback: number): number {
  const parsed = parseNumber(value);
  const effective = typeof parsed === "number" ? parsed : fallback;
  return Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(effective)));
}

function resolveSearchSettings(): SearchSettings {
  return {
    enabled: parseBoolean(process.env.TOOL_WEB_SEARCH_ENABLED, true),
    maxResults: resolveSearchCount(
      parseNumber(process.env.TOOL_WEB_SEARCH_MAX_RESULTS),
      DEFAULT_SEARCH_COUNT,
    ),
    timeoutSeconds: resolveTimeoutSeconds(
      parseNumber(process.env.TOOL_WEB_SEARCH_TIMEOUT_SECONDS),
      DEFAULT_TIMEOUT_SECONDS,
    ),
    cacheTtlMs: resolveCacheTtlMs(
      parseNumber(process.env.TOOL_WEB_SEARCH_CACHE_TTL_MINUTES),
      DEFAULT_CACHE_TTL_MINUTES,
    ),
    retryAttempts: Math.max(
      1,
      Math.min(
        5,
        Math.floor(
          parseNumber(process.env.TOOL_WEB_SEARCH_RETRY_ATTEMPTS) ??
            DEFAULT_SEARCH_RETRY_ATTEMPTS,
        ),
      ),
    ),
    retryBaseDelayMs: Math.max(
      100,
      Math.min(
        5_000,
        Math.floor(
          parseNumber(process.env.TOOL_WEB_SEARCH_RETRY_BASE_DELAY_MS) ??
            DEFAULT_SEARCH_RETRY_BASE_DELAY_MS,
        ),
      ),
    ),
    anthropicApiKey:
      parseString(process.env.TOOL_WEB_SEARCH_ANTHROPIC_API_KEY) ??
      parseString(process.env.ANTHROPIC_API_KEY),
    anthropicModel:
      parseString(process.env.TOOL_WEB_SEARCH_ANTHROPIC_MODEL) ?? DEFAULT_ANTHROPIC_MODEL,
    toolType:
      parseString(process.env.TOOL_WEB_SEARCH_ANTHROPIC_TOOL_TYPE) ??
      DEFAULT_ANTHROPIC_WEB_SEARCH_TOOL,
    fallbackToolType:
      parseString(process.env.TOOL_WEB_SEARCH_ANTHROPIC_FALLBACK_TOOL_TYPE) ??
      FALLBACK_ANTHROPIC_WEB_SEARCH_TOOL,
  };
}

function resolveFetchSettings(): FetchSettings {
  return {
    enabled: parseBoolean(process.env.TOOL_WEB_FETCH_ENABLED, true),
    maxChars: Math.max(
      100,
      Math.floor(parseNumber(process.env.TOOL_WEB_FETCH_MAX_CHARS) ?? DEFAULT_FETCH_MAX_CHARS),
    ),
    timeoutSeconds: resolveTimeoutSeconds(
      parseNumber(process.env.TOOL_WEB_FETCH_TIMEOUT_SECONDS),
      DEFAULT_TIMEOUT_SECONDS,
    ),
    cacheTtlMs: resolveCacheTtlMs(
      parseNumber(process.env.TOOL_WEB_FETCH_CACHE_TTL_MINUTES),
      DEFAULT_CACHE_TTL_MINUTES,
    ),
    anthropicApiKey:
      parseString(process.env.TOOL_WEB_FETCH_ANTHROPIC_API_KEY) ??
      parseString(process.env.ANTHROPIC_API_KEY),
    anthropicModel:
      parseString(process.env.TOOL_WEB_FETCH_ANTHROPIC_MODEL) ?? DEFAULT_ANTHROPIC_MODEL,
    toolType:
      parseString(process.env.TOOL_WEB_FETCH_ANTHROPIC_TOOL_TYPE) ??
      DEFAULT_ANTHROPIC_WEB_FETCH_TOOL,
    fallbackToolType:
      parseString(process.env.TOOL_WEB_FETCH_ANTHROPIC_FALLBACK_TOOL_TYPE) ??
      FALLBACK_ANTHROPIC_WEB_FETCH_TOOL,
  };
}

function retryDelayFromHeaders(headers: Headers): number | undefined {
  const retryAfter = headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) {
      const delay = dateMs - Date.now();
      if (delay > 0) return delay;
    }
  }
  return undefined;
}

function isRetryableAnthropicError(error: unknown): boolean {
  if (error instanceof AnthropicHttpError) {
    return error.status === 429 || error.status >= 500;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("timeout") || message.includes("network") || message.includes("fetch failed");
}

function isUnknownToolTypeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("tool") &&
    (message.includes("unknown") || message.includes("invalid")) &&
    message.includes("type")
  );
}

async function runAnthropicWithRetry<T>(params: {
  attempts: number;
  baseDelayMs: number;
  run: () => Promise<T>;
}): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= params.attempts; attempt += 1) {
    try {
      return await params.run();
    } catch (error) {
      lastError = error;
      if (!isRetryableAnthropicError(error) || attempt >= params.attempts) {
        throw error;
      }
      const retryAfterMs =
        error instanceof AnthropicHttpError ? error.retryAfterMs : undefined;
      const computed = computeExponentialBackoffDelay({
        attempt,
        baseDelayMs: params.baseDelayMs,
        maxDelayMs: 8_000,
        jitterMaxMs: 350,
      });
      await sleep(Math.max(computed, retryAfterMs ?? 0));
    }
  }
  throw lastError;
}

async function runAnthropicToolCall(params: {
  apiKey: string;
  model: string;
  prompt: string;
  timeoutSeconds: number;
  toolType: string;
}): Promise<AnthropicMessageResponse> {
  const response = await fetch(ANTHROPIC_MESSAGES_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": ANTHROPIC_VERSION_HEADER,
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 1_200,
      messages: [{ role: "user", content: params.prompt }],
      tools: [{
        type: params.toolType,
        name: "web",
        max_uses: 1,
      }],
    }),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!response.ok) {
    const detail = await readResponseText(response);
    throw new AnthropicHttpError(
      `Anthropic API error (${response.status}): ${detail || response.statusText}`,
      response.status,
      retryDelayFromHeaders(response.headers),
    );
  }

  return (await response.json()) as AnthropicMessageResponse;
}

function collectResponseText(content: AnthropicContentBlock[]): string {
  const text = content
    .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("\n")
    .trim();
  if (text.length > 0) return text;
  return JSON.stringify(content, null, 2);
}

function toCitation(value: unknown): AnthropicCitation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const url =
    (typeof record.url === "string" ? record.url : undefined) ??
    (typeof record.source === "string" ? record.source : undefined);
  if (!url || !/^https?:\/\//iu.test(url)) return null;
  return {
    url,
    title: typeof record.title === "string" ? record.title : undefined,
  };
}

function collectCitations(content: AnthropicContentBlock[]): AnthropicCitation[] {
  const out: AnthropicCitation[] = [];
  for (const block of content) {
    const candidates: unknown[] = [];
    if (Array.isArray(block.citations)) candidates.push(...block.citations);
    if (Array.isArray(block.sources)) candidates.push(...block.sources);
    for (const candidate of candidates) {
      const citation = toCitation(candidate);
      if (citation) out.push(citation);
    }
  }
  const byUrl = new Map<string, AnthropicCitation>();
  for (const citation of out) {
    byUrl.set(citation.url, citation);
  }
  return Array.from(byUrl.values());
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)\]]+/giu) ?? [];
  return Array.from(new Set(matches));
}

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: value.slice(0, maxChars), truncated: true };
}

function formatFailure(params: {
  code: string;
  message: string;
  docs?: string;
  detail?: string;
}): ToolResult {
  return {
    success: false,
    error: params.code,
    message: params.message,
    data: {
      docs: params.docs,
      detail: params.detail,
    },
    meta: {
      resource: "knowledge",
    },
  };
}

function sanitizeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.slice(0, 200);
  }
}

async function runAnthropicSearch(params: {
  query: string;
  count: number;
  settings: SearchSettings;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    [
      params.query,
      params.count,
      params.settings.anthropicModel,
      params.settings.toolType,
    ].join(":"),
  );

  const stale = getExpiredCacheValue(SEARCH_CACHE, cacheKey);
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) return { ...cached.value, cached: true };

  const startedAt = Date.now();
  const timeoutSeconds = resolveTimeoutSecondsWithRuntimeBudget({
    timeoutSeconds: params.settings.timeoutSeconds,
    reserveMs: 2_000,
  });

  const runWithToolType = async (toolType: string) => {
    const prompt = [
      `Search the public web for: ${params.query}`,
      "Use the web search tool.",
      `Return up to ${params.count} relevant results with title, URL, and a brief snippet.`,
      "Include source links in the answer.",
    ].join("\n");

    const response = await runAnthropicWithRetry({
      attempts: params.settings.retryAttempts,
      baseDelayMs: params.settings.retryBaseDelayMs,
      run: async () =>
        runAnthropicToolCall({
          apiKey: params.settings.anthropicApiKey ?? "",
          model: params.settings.anthropicModel,
          prompt,
          timeoutSeconds,
          toolType,
        }),
    });

    const content = Array.isArray(response.content) ? response.content : [];
    const answer = collectResponseText(content);
    const citations = collectCitations(content);
    const fallbackUrls = extractUrls(answer).map((url) => ({ url, title: undefined }));
    const sources = citations.length > 0 ? citations : fallbackUrls;

    return {
      provider: "anthropic",
      model: response.model ?? params.settings.anthropicModel,
      toolType,
      query: params.query,
      count: Math.min(params.count, sources.length > 0 ? sources.length : params.count),
      results: sources.slice(0, params.count).map((source) => ({
        title: source.title ?? source.url,
        url: source.url,
        description: undefined,
      })),
      answer,
      citations: sources,
      rawContent: content,
      usage: response.usage ?? undefined,
      tookMs: Date.now() - startedAt,
    } satisfies Record<string, unknown>;
  };

  try {
    const payload = await runWithToolType(params.settings.toolType);
    writeCache(SEARCH_CACHE, cacheKey, payload, params.settings.cacheTtlMs);
    return payload;
  } catch (error) {
    if (
      isUnknownToolTypeError(error) &&
      params.settings.fallbackToolType !== params.settings.toolType
    ) {
      try {
        const payload = await runWithToolType(params.settings.fallbackToolType);
        writeCache(SEARCH_CACHE, cacheKey, payload, params.settings.cacheTtlMs);
        return payload;
      } catch {
        // fallthrough and handle original error path below
      }
    }
    if (stale) {
      return {
        ...stale.value,
        cached: true,
        stale: true,
        staleAgeMs: stale.staleAgeMs,
        fallback: "stale_if_error",
      };
    }
    throw error;
  }
}

async function runAnthropicFetch(params: {
  url: string;
  maxChars: number;
  extractMode: "markdown" | "text";
  settings: FetchSettings;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    [params.url, params.extractMode, params.maxChars, params.settings.toolType].join(":"),
  );
  const stale = getExpiredCacheValue(FETCH_CACHE, cacheKey);
  const cached = readCache(FETCH_CACHE, cacheKey);
  if (cached) return { ...cached.value, cached: true };

  const startedAt = Date.now();
  const timeoutSeconds = resolveTimeoutSecondsWithRuntimeBudget({
    timeoutSeconds: params.settings.timeoutSeconds,
    reserveMs: 1_000,
  });

  const runWithToolType = async (toolType: string) => {
    const prompt = [
      `Fetch this URL: ${params.url}`,
      "Use the web fetch tool.",
      `Return extracted ${params.extractMode} content only.`,
      `Keep the extracted content under about ${params.maxChars} characters.`,
    ].join("\n");

    const response = await runAnthropicToolCall({
      apiKey: params.settings.anthropicApiKey ?? "",
      model: params.settings.anthropicModel,
      prompt,
      timeoutSeconds,
      toolType,
    });
    const content = Array.isArray(response.content) ? response.content : [];
    const extracted = collectResponseText(content);
    const truncated = truncateText(extracted, params.maxChars);

    return {
      url: params.url,
      finalUrl: params.url,
      status: 200,
      extractor: "anthropic_web_fetch",
      content: truncated.text,
      truncated: truncated.truncated,
      model: response.model ?? params.settings.anthropicModel,
      toolType,
      rawContent: content,
      usage: response.usage ?? undefined,
      tookMs: Date.now() - startedAt,
    } satisfies Record<string, unknown>;
  };

  try {
    const payload = await runWithToolType(params.settings.toolType);
    writeCache(FETCH_CACHE, cacheKey, payload, params.settings.cacheTtlMs);
    return payload;
  } catch (error) {
    if (
      isUnknownToolTypeError(error) &&
      params.settings.fallbackToolType !== params.settings.toolType
    ) {
      try {
        const payload = await runWithToolType(params.settings.fallbackToolType);
        writeCache(FETCH_CACHE, cacheKey, payload, params.settings.cacheTtlMs);
        return payload;
      } catch {
        // fallthrough to stale handling
      }
    }
    if (stale) {
      return {
        ...stale.value,
        cached: true,
        stale: true,
        staleAgeMs: stale.staleAgeMs,
        fallback: "stale_if_error",
      };
    }
    throw error;
  }
}

export function createWebCapabilities(env: CapabilityEnvironment): WebCapabilities {
  return {
    async search(input) {
      const settings = resolveSearchSettings();
      if (!settings.enabled) {
        return formatFailure({
          code: "web_search_disabled",
          message: "Web search is disabled by runtime configuration.",
        });
      }

      const query = input.query?.trim();
      if (!query) {
        return formatFailure({
          code: "query_required",
          message: "web.search requires a non-empty query string.",
          docs: ANTHROPIC_WEB_SEARCH_DOCS_URL,
        });
      }

      if (!settings.anthropicApiKey) {
        return formatFailure({
          code: "missing_anthropic_api_key",
          message: "web.search requires ANTHROPIC_API_KEY or TOOL_WEB_SEARCH_ANTHROPIC_API_KEY.",
          docs: ANTHROPIC_WEB_SEARCH_DOCS_URL,
        });
      }

      try {
        const data = await runAnthropicSearch({
          query,
          count: resolveSearchCount(input.count, settings.maxResults),
          settings,
        });

        return {
          success: true,
          data,
          message: "Web search completed.",
          meta: {
            resource: "knowledge",
            itemCount: Array.isArray(data.results) ? data.results.length : undefined,
            durationMs: typeof data.tookMs === "number" ? data.tookMs : undefined,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown web.search error";
        env.runtime.logger.warn("web.search failed", {
          query: query.slice(0, 120),
          error: message,
        });
        return formatFailure({
          code: "web_search_failed",
          message: "web.search failed while fetching results.",
          detail: message.slice(0, DEFAULT_ERROR_MAX_CHARS),
          docs: ANTHROPIC_WEB_SEARCH_DOCS_URL,
        });
      }
    },

    async fetch(input) {
      const settings = resolveFetchSettings();
      if (!settings.enabled) {
        return formatFailure({
          code: "web_fetch_disabled",
          message: "Web fetch is disabled by runtime configuration.",
        });
      }

      const url = input.url?.trim();
      if (!url) {
        return formatFailure({
          code: "url_required",
          message: "web.fetch requires a URL.",
        });
      }

      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return formatFailure({
          code: "invalid_url",
          message: "Invalid URL: must be an absolute http/https URL.",
        });
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return formatFailure({
          code: "invalid_url_scheme",
          message: "Invalid URL: only http and https are supported.",
        });
      }

      if (!settings.anthropicApiKey) {
        return formatFailure({
          code: "missing_anthropic_api_key",
          message: "web.fetch requires ANTHROPIC_API_KEY or TOOL_WEB_FETCH_ANTHROPIC_API_KEY.",
          docs: ANTHROPIC_WEB_FETCH_DOCS_URL,
        });
      }

      const extractMode: "markdown" | "text" = input.extractMode === "text" ? "text" : "markdown";
      const maxChars = Math.max(
        100,
        Math.floor(
          typeof input.maxChars === "number" && Number.isFinite(input.maxChars)
            ? input.maxChars
            : settings.maxChars,
        ),
      );

      try {
        const data = await runAnthropicFetch({
          url,
          maxChars,
          extractMode,
          settings,
        });

        return {
          success: true,
          data,
          message: "Web fetch completed.",
          meta: {
            resource: "knowledge",
            itemCount: typeof data.content === "string" ? 1 : undefined,
            durationMs: typeof data.tookMs === "number" ? data.tookMs : undefined,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown web.fetch error";
        env.runtime.logger.warn("web.fetch failed", {
          url: sanitizeUrlForLog(url),
          error: message,
        });
        return formatFailure({
          code: "web_fetch_failed",
          message: "web.fetch failed while retrieving content.",
          detail: message.slice(0, DEFAULT_ERROR_MAX_CHARS),
          docs: ANTHROPIC_WEB_FETCH_DOCS_URL,
        });
      }
    },
  };
}

export const __testing = {
  clearCaches: () => {
    SEARCH_CACHE.clear();
    FETCH_CACHE.clear();
  },
} as const;
