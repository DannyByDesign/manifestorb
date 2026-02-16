// Fork-adapted from OpenClaw web tooling:
// /Users/dannywang/Projects/openclaw/src/agents/tools/web-search.ts
// /Users/dannywang/Projects/openclaw/src/agents/tools/web-fetch.ts
import type { Dispatcher } from "undici";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import type { ToolResult } from "@/server/features/ai/tools/types";
import {
  CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  clearRuntimeWebCache,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  withTimeout,
  writeCache,
} from "@/server/features/ai/tools/runtime/capabilities/web-shared";
import {
  type ExtractMode,
  extractReadableContent,
  htmlToMarkdown,
  markdownToText,
  truncateText,
} from "@/server/features/ai/tools/runtime/capabilities/web-fetch-utils";
import {
  closeDispatcher,
  createPinnedDispatcher,
  resolvePinnedHostname,
  SsrfBlockedError,
} from "@/server/features/ai/tools/runtime/capabilities/web-ssrf";

const SEARCH_PROVIDERS = ["brave", "perplexity"] as const;
type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_PERPLEXITY_BASE_URL = "https://openrouter.ai/api/v1";
const PERPLEXITY_DIRECT_BASE_URL = "https://api.perplexity.ai";
const DEFAULT_PERPLEXITY_MODEL = "perplexity/sonar-pro";
const PERPLEXITY_KEY_PREFIXES = ["pplx-"];
const OPENROUTER_KEY_PREFIXES = ["sk-or-"];

const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;
const BRAVE_FRESHNESS_SHORTCUTS = new Set(["pd", "pw", "pm", "py"]);
const BRAVE_FRESHNESS_RANGE = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/;

const DEFAULT_FETCH_MAX_CHARS = 50_000;
const DEFAULT_FETCH_MAX_REDIRECTS = 3;
const DEFAULT_ERROR_MAX_CHARS = 4_000;
const DEFAULT_FETCH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const DEFAULT_FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
const DEFAULT_FIRECRAWL_MAX_AGE_MS = 172_800_000;

const WEB_DOCS_URL = "https://brave.com/search/api/";
const FIRECRAWL_DOCS_URL = "https://docs.firecrawl.dev/";

type PerplexityApiKeySource = "config" | "perplexity_env" | "openrouter_env" | "none";

type SearchSettings = {
  enabled: boolean;
  provider: SearchProvider;
  maxResults: number;
  timeoutSeconds: number;
  cacheTtlMs: number;
  braveApiKey?: string;
  perplexityApiKey?: string;
  perplexityApiKeySource: PerplexityApiKeySource;
  perplexityBaseUrl: string;
  perplexityModel: string;
};

type FetchSettings = {
  enabled: boolean;
  maxChars: number;
  timeoutSeconds: number;
  cacheTtlMs: number;
  maxRedirects: number;
  userAgent: string;
  readability: boolean;
  firecrawl: {
    enabled: boolean;
    apiKey?: string;
    baseUrl: string;
    onlyMainContent: boolean;
    maxAgeMs: number;
    timeoutSeconds: number;
  };
};

type BraveSearchResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
};

type BraveSearchResponse = {
  web?: {
    results?: BraveSearchResult[];
  };
};

type PerplexitySearchResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  citations?: string[];
};

type PerplexityBaseUrlHint = "direct" | "openrouter";

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
  }): Promise<ToolResult>;
  fetch(input: {
    url: string;
    extractMode?: "markdown" | "text";
    maxChars?: number;
  }): Promise<ToolResult>;
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

function resolveSearchProvider(value: unknown): SearchProvider {
  const normalized = parseString(value)?.toLowerCase();
  if (normalized && (SEARCH_PROVIDERS as readonly string[]).includes(normalized)) {
    return normalized as SearchProvider;
  }
  return "brave";
}

function resolveSearchCount(value: unknown, fallback: number): number {
  const parsed = parseNumber(value);
  const effective = typeof parsed === "number" ? parsed : fallback;
  return Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(effective)));
}

function inferPerplexityBaseUrlFromApiKey(apiKey?: string): PerplexityBaseUrlHint | undefined {
  if (!apiKey) return undefined;
  const normalized = apiKey.toLowerCase();
  if (PERPLEXITY_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "direct";
  }
  if (OPENROUTER_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "openrouter";
  }
  return undefined;
}

function resolvePerplexityBaseUrl(params: {
  explicitBaseUrl?: string;
  apiKeySource: PerplexityApiKeySource;
  apiKey?: string;
}): string {
  if (params.explicitBaseUrl) return params.explicitBaseUrl;
  if (params.apiKeySource === "perplexity_env") return PERPLEXITY_DIRECT_BASE_URL;
  if (params.apiKeySource === "openrouter_env") return DEFAULT_PERPLEXITY_BASE_URL;
  if (params.apiKeySource === "config") {
    const inferred = inferPerplexityBaseUrlFromApiKey(params.apiKey);
    if (inferred === "direct") return PERPLEXITY_DIRECT_BASE_URL;
    if (inferred === "openrouter") return DEFAULT_PERPLEXITY_BASE_URL;
  }
  return DEFAULT_PERPLEXITY_BASE_URL;
}

function resolveSearchSettings(): SearchSettings {
  const provider = resolveSearchProvider(process.env.TOOL_WEB_SEARCH_PROVIDER);
  const braveApiKey =
    parseString(process.env.TOOL_WEB_SEARCH_BRAVE_API_KEY) ?? parseString(process.env.BRAVE_API_KEY);
  const perplexityFromConfig = parseString(process.env.TOOL_WEB_SEARCH_PERPLEXITY_API_KEY);
  const perplexityFromEnv = parseString(process.env.PERPLEXITY_API_KEY);
  const openRouterFromEnv = parseString(process.env.OPENROUTER_API_KEY);

  let perplexityApiKey = perplexityFromConfig;
  let perplexityApiKeySource: PerplexityApiKeySource = "none";
  if (perplexityApiKey) {
    perplexityApiKeySource = "config";
  } else if (perplexityFromEnv) {
    perplexityApiKey = perplexityFromEnv;
    perplexityApiKeySource = "perplexity_env";
  } else if (openRouterFromEnv) {
    perplexityApiKey = openRouterFromEnv;
    perplexityApiKeySource = "openrouter_env";
  }

  const perplexityBaseUrl = resolvePerplexityBaseUrl({
    explicitBaseUrl: parseString(process.env.TOOL_WEB_SEARCH_PERPLEXITY_BASE_URL),
    apiKeySource: perplexityApiKeySource,
    apiKey: perplexityApiKey,
  });

  const perplexityModel =
    parseString(process.env.TOOL_WEB_SEARCH_PERPLEXITY_MODEL) ?? DEFAULT_PERPLEXITY_MODEL;
  const maxResults = resolveSearchCount(
    parseNumber(process.env.TOOL_WEB_SEARCH_MAX_RESULTS),
    DEFAULT_SEARCH_COUNT,
  );
  const timeoutSeconds = resolveTimeoutSeconds(
    parseNumber(process.env.TOOL_WEB_SEARCH_TIMEOUT_SECONDS),
    DEFAULT_TIMEOUT_SECONDS,
  );
  const cacheTtlMs = resolveCacheTtlMs(
    parseNumber(process.env.TOOL_WEB_SEARCH_CACHE_TTL_MINUTES),
    DEFAULT_CACHE_TTL_MINUTES,
  );

  return {
    enabled: parseBoolean(process.env.TOOL_WEB_SEARCH_ENABLED, true),
    provider,
    maxResults,
    timeoutSeconds,
    cacheTtlMs,
    braveApiKey,
    perplexityApiKey,
    perplexityApiKeySource,
    perplexityBaseUrl,
    perplexityModel,
  };
}

function resolveFetchSettings(): FetchSettings {
  const firecrawlApiKey =
    parseString(process.env.TOOL_WEB_FETCH_FIRECRAWL_API_KEY) ??
    parseString(process.env.FIRECRAWL_API_KEY);

  const timeoutSeconds = resolveTimeoutSeconds(
    parseNumber(process.env.TOOL_WEB_FETCH_TIMEOUT_SECONDS),
    DEFAULT_TIMEOUT_SECONDS,
  );

  return {
    enabled: parseBoolean(process.env.TOOL_WEB_FETCH_ENABLED, true),
    maxChars: Math.max(
      100,
      Math.floor(parseNumber(process.env.TOOL_WEB_FETCH_MAX_CHARS) ?? DEFAULT_FETCH_MAX_CHARS),
    ),
    timeoutSeconds,
    cacheTtlMs: resolveCacheTtlMs(
      parseNumber(process.env.TOOL_WEB_FETCH_CACHE_TTL_MINUTES),
      DEFAULT_CACHE_TTL_MINUTES,
    ),
    maxRedirects: Math.max(
      0,
      Math.floor(parseNumber(process.env.TOOL_WEB_FETCH_MAX_REDIRECTS) ?? DEFAULT_FETCH_MAX_REDIRECTS),
    ),
    userAgent: parseString(process.env.TOOL_WEB_FETCH_USER_AGENT) ?? DEFAULT_FETCH_USER_AGENT,
    readability: parseBoolean(process.env.TOOL_WEB_FETCH_READABILITY, true),
    firecrawl: {
      enabled: parseBoolean(process.env.TOOL_WEB_FETCH_FIRECRAWL_ENABLED, Boolean(firecrawlApiKey)),
      apiKey: firecrawlApiKey,
      baseUrl: parseString(process.env.TOOL_WEB_FETCH_FIRECRAWL_BASE_URL) ?? DEFAULT_FIRECRAWL_BASE_URL,
      onlyMainContent: parseBoolean(process.env.TOOL_WEB_FETCH_FIRECRAWL_ONLY_MAIN_CONTENT, true),
      maxAgeMs: Math.max(
        0,
        Math.floor(
          parseNumber(process.env.TOOL_WEB_FETCH_FIRECRAWL_MAX_AGE_MS) ?? DEFAULT_FIRECRAWL_MAX_AGE_MS,
        ),
      ),
      timeoutSeconds: resolveTimeoutSeconds(
        parseNumber(process.env.TOOL_WEB_FETCH_FIRECRAWL_TIMEOUT_SECONDS),
        timeoutSeconds,
      ),
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

function resolveSiteName(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function normalizeFreshness(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const lower = trimmed.toLowerCase();
  if (BRAVE_FRESHNESS_SHORTCUTS.has(lower)) return lower;

  const match = trimmed.match(BRAVE_FRESHNESS_RANGE);
  if (!match) return undefined;

  const [, start, end] = match;
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) return undefined;
  if (start > end) return undefined;
  return `${start}to${end}`;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function formatFailure(params: {
  code: string;
  message: string;
  docs?: string;
  resource?: string;
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
      resource: params.resource ?? "knowledge",
    },
  };
}

function looksLikeHtml(value: string): boolean {
  const trimmed = value.trimStart();
  if (!trimmed) return false;
  const head = trimmed.slice(0, 256).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function resolveFirecrawlEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return `${DEFAULT_FIRECRAWL_BASE_URL}/v2/scrape`;
  try {
    const url = new URL(trimmed);
    if (url.pathname && url.pathname !== "/") {
      return url.toString();
    }
    url.pathname = "/v2/scrape";
    return url.toString();
  } catch {
    return `${DEFAULT_FIRECRAWL_BASE_URL}/v2/scrape`;
  }
}

async function runPerplexitySearch(params: {
  query: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
}): Promise<{ content: string; citations: string[] }> {
  const endpoint = `${params.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
      "HTTP-Referer": "https://app.getamodel.com",
      "X-Title": "Amodel Web Search",
    },
    body: JSON.stringify({
      model: params.model,
      messages: [{ role: "user", content: params.query }],
    }),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!response.ok) {
    const detail = await readResponseText(response);
    throw new Error(`Perplexity API error (${response.status}): ${detail || response.statusText}`);
  }

  const data = (await response.json()) as PerplexitySearchResponse;
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    citations: data.citations ?? [],
  };
}

async function runWebSearch(params: {
  query: string;
  count: number;
  country?: string;
  searchLang?: string;
  uiLang?: string;
  freshness?: string;
  settings: SearchSettings;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    [
      params.settings.provider,
      params.query,
      params.count,
      params.country ?? "default",
      params.searchLang ?? "default",
      params.uiLang ?? "default",
      params.freshness ?? "default",
    ].join(":"),
  );
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) return { ...cached.value, cached: true };

  const startedAt = Date.now();
  if (params.settings.provider === "perplexity") {
    const result = await runPerplexitySearch({
      query: params.query,
      apiKey: params.settings.perplexityApiKey ?? "",
      baseUrl: params.settings.perplexityBaseUrl,
      model: params.settings.perplexityModel,
      timeoutSeconds: params.settings.timeoutSeconds,
    });
    const payload = {
      query: params.query,
      provider: "perplexity",
      model: params.settings.perplexityModel,
      tookMs: Date.now() - startedAt,
      content: result.content,
      citations: result.citations,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, params.settings.cacheTtlMs);
    return payload;
  }

  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", params.query);
  url.searchParams.set("count", String(params.count));
  if (params.country) url.searchParams.set("country", params.country);
  if (params.searchLang) url.searchParams.set("search_lang", params.searchLang);
  if (params.uiLang) url.searchParams.set("ui_lang", params.uiLang);
  if (params.freshness) url.searchParams.set("freshness", params.freshness);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": params.settings.braveApiKey ?? "",
    },
    signal: withTimeout(undefined, params.settings.timeoutSeconds * 1000),
  });
  if (!response.ok) {
    const detail = await readResponseText(response);
    throw new Error(`Brave API error (${response.status}): ${detail || response.statusText}`);
  }

  const data = (await response.json()) as BraveSearchResponse;
  const results = Array.isArray(data.web?.results) ? data.web?.results ?? [] : [];
  const mapped = results.map((entry) => ({
    title: entry.title ?? "",
    url: entry.url ?? "",
    description: entry.description ?? "",
    published: entry.age ?? undefined,
    siteName: resolveSiteName(entry.url ?? ""),
  }));

  const payload = {
    query: params.query,
    provider: "brave",
    count: mapped.length,
    tookMs: Date.now() - startedAt,
    results: mapped,
  };
  writeCache(SEARCH_CACHE, cacheKey, payload, params.settings.cacheTtlMs);
  return payload;
}

async function fetchWithRedirects(params: {
  url: string;
  maxRedirects: number;
  timeoutSeconds: number;
  userAgent: string;
}): Promise<{ response: Response; finalUrl: string; dispatcher: Dispatcher }> {
  const signal = withTimeout(undefined, params.timeoutSeconds * 1000);
  const visited = new Set<string>();
  let currentUrl = params.url;
  let redirectCount = 0;

  while (true) {
    const parsedUrl = new URL(currentUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Invalid URL: must be http or https");
    }

    const pinned = await resolvePinnedHostname(parsedUrl.hostname);
    const dispatcher = createPinnedDispatcher(pinned);

    let response: Response;
    try {
      response = await fetch(parsedUrl.toString(), {
        method: "GET",
        headers: {
          Accept: "*/*",
          "User-Agent": params.userAgent,
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal,
        redirect: "manual",
        dispatcher,
      } as RequestInit);
    } catch (error) {
      await closeDispatcher(dispatcher);
      throw error;
    }

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        await closeDispatcher(dispatcher);
        throw new Error(`Redirect missing location header (${response.status})`);
      }
      redirectCount += 1;
      if (redirectCount > params.maxRedirects) {
        await closeDispatcher(dispatcher);
        throw new Error(`Too many redirects (limit: ${params.maxRedirects})`);
      }

      const nextUrl = new URL(location, parsedUrl).toString();
      if (visited.has(nextUrl)) {
        await closeDispatcher(dispatcher);
        throw new Error("Redirect loop detected");
      }
      visited.add(nextUrl);
      void response.body?.cancel();
      await closeDispatcher(dispatcher);
      currentUrl = nextUrl;
      continue;
    }

    return { response, finalUrl: currentUrl, dispatcher };
  }
}

function formatWebFetchErrorDetail(params: {
  detail: string;
  contentType?: string | null;
  maxChars: number;
}): string {
  if (!params.detail) return "";
  let text = params.detail;
  const contentTypeLower = params.contentType?.toLowerCase();
  if (contentTypeLower?.includes("text/html") || looksLikeHtml(text)) {
    const rendered = htmlToMarkdown(text);
    const withTitle = rendered.title ? `${rendered.title}\n${rendered.text}` : rendered.text;
    text = markdownToText(withTitle);
  }
  const truncated = truncateText(text.trim(), params.maxChars);
  return truncated.text;
}

async function fetchFirecrawlContent(params: {
  url: string;
  extractMode: ExtractMode;
  apiKey: string;
  baseUrl: string;
  onlyMainContent: boolean;
  maxAgeMs: number;
  timeoutSeconds: number;
}): Promise<{ content: string; title?: string; finalUrl?: string; status?: number; warning?: string }> {
  const endpoint = resolveFirecrawlEndpoint(params.baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: params.url,
      formats: ["markdown"],
      onlyMainContent: params.onlyMainContent,
      timeout: params.timeoutSeconds * 1000,
      maxAge: params.maxAgeMs,
      proxy: "auto",
      storeInCache: true,
    }),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  const payload = (await response.json()) as {
    success?: boolean;
    data?: {
      markdown?: string;
      content?: string;
      metadata?: {
        title?: string;
        sourceURL?: string;
        statusCode?: number;
      };
    };
    warning?: string;
    error?: string;
  };

  if (!response.ok || payload.success === false) {
    const detail = payload.error || response.statusText;
    throw new Error(`Firecrawl fetch failed (${response.status}): ${detail}`.trim());
  }

  const rawContent =
    typeof payload.data?.markdown === "string"
      ? payload.data.markdown
      : typeof payload.data?.content === "string"
        ? payload.data.content
        : "";
  const content = params.extractMode === "text" ? markdownToText(rawContent) : rawContent;
  return {
    content,
    title: payload.data?.metadata?.title,
    finalUrl: payload.data?.metadata?.sourceURL,
    status: payload.data?.metadata?.statusCode,
    warning: payload.warning,
  };
}

async function runWebFetch(params: {
  url: string;
  extractMode: ExtractMode;
  maxChars: number;
  settings: FetchSettings;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(`fetch:${params.url}:${params.extractMode}:${params.maxChars}`);
  const cached = readCache(FETCH_CACHE, cacheKey);
  if (cached) return { ...cached.value, cached: true };

  const parsedUrl = new URL(params.url);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Invalid URL: must be http or https");
  }

  const startedAt = Date.now();
  let response: Response;
  let dispatcher: Dispatcher | null = null;
  let finalUrl = params.url;

  try {
    const fetched = await fetchWithRedirects({
      url: params.url,
      maxRedirects: params.settings.maxRedirects,
      timeoutSeconds: params.settings.timeoutSeconds,
      userAgent: params.settings.userAgent,
    });
    response = fetched.response;
    finalUrl = fetched.finalUrl;
    dispatcher = fetched.dispatcher;
  } catch (error) {
    if (error instanceof SsrfBlockedError) throw error;
    if (params.settings.firecrawl.enabled && params.settings.firecrawl.apiKey) {
      const firecrawl = await fetchFirecrawlContent({
        url: finalUrl,
        extractMode: params.extractMode,
        apiKey: params.settings.firecrawl.apiKey,
        baseUrl: params.settings.firecrawl.baseUrl,
        onlyMainContent: params.settings.firecrawl.onlyMainContent,
        maxAgeMs: params.settings.firecrawl.maxAgeMs,
        timeoutSeconds: params.settings.firecrawl.timeoutSeconds,
      });
      const truncated = truncateText(firecrawl.content, params.maxChars);
      const payload = {
        url: params.url,
        finalUrl: firecrawl.finalUrl || finalUrl,
        status: firecrawl.status ?? 200,
        extractor: "firecrawl",
        content: truncated.text,
        tookMs: Date.now() - startedAt,
        truncated: truncated.truncated,
        warning: firecrawl.warning,
      };
      writeCache(FETCH_CACHE, cacheKey, payload, params.settings.cacheTtlMs);
      return payload;
    }
    throw error;
  }

  try {
    if (!response.ok) {
      if (params.settings.firecrawl.enabled && params.settings.firecrawl.apiKey) {
        const firecrawl = await fetchFirecrawlContent({
          url: params.url,
          extractMode: params.extractMode,
          apiKey: params.settings.firecrawl.apiKey,
          baseUrl: params.settings.firecrawl.baseUrl,
          onlyMainContent: params.settings.firecrawl.onlyMainContent,
          maxAgeMs: params.settings.firecrawl.maxAgeMs,
          timeoutSeconds: params.settings.firecrawl.timeoutSeconds,
        });
        const truncated = truncateText(firecrawl.content, params.maxChars);
        const payload = {
          url: params.url,
          finalUrl: firecrawl.finalUrl || finalUrl,
          status: firecrawl.status ?? response.status,
          extractor: "firecrawl",
          content: truncated.text,
          tookMs: Date.now() - startedAt,
          truncated: truncated.truncated,
          warning: firecrawl.warning,
        };
        writeCache(FETCH_CACHE, cacheKey, payload, params.settings.cacheTtlMs);
        return payload;
      }

      const rawDetail = await readResponseText(response);
      const detail = formatWebFetchErrorDetail({
        detail: rawDetail,
        contentType: response.headers.get("content-type"),
        maxChars: DEFAULT_ERROR_MAX_CHARS,
      });
      throw new Error(`Web fetch failed (${response.status}): ${detail || response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const body = await readResponseText(response);

    let content = body;
    let extractor = "raw";

    if (contentType.includes("text/html")) {
      if (params.settings.readability) {
        const readable = await extractReadableContent({
          html: body,
          url: finalUrl,
          extractMode: params.extractMode,
        });
        if (readable?.text) {
          content = readable.text;
          extractor = "readability";
        } else if (params.settings.firecrawl.enabled && params.settings.firecrawl.apiKey) {
          const firecrawl = await fetchFirecrawlContent({
            url: finalUrl,
            extractMode: params.extractMode,
            apiKey: params.settings.firecrawl.apiKey,
            baseUrl: params.settings.firecrawl.baseUrl,
            onlyMainContent: params.settings.firecrawl.onlyMainContent,
            maxAgeMs: params.settings.firecrawl.maxAgeMs,
            timeoutSeconds: params.settings.firecrawl.timeoutSeconds,
          });
          content = firecrawl.content;
          extractor = "firecrawl";
        } else {
          const rendered = htmlToMarkdown(body);
          content = params.extractMode === "text" ? markdownToText(rendered.text) : rendered.text;
          extractor = "raw";
        }
      } else {
        const rendered = htmlToMarkdown(body);
        content = params.extractMode === "text" ? markdownToText(rendered.text) : rendered.text;
        extractor = "raw";
      }
    } else if (contentType.includes("application/json")) {
      try {
        content = JSON.stringify(JSON.parse(body), null, 2);
        extractor = "json";
      } catch {
        content = body;
        extractor = "raw";
      }
    }

    const truncated = truncateText(content, params.maxChars);
    const payload = {
      url: params.url,
      finalUrl,
      status: response.status,
      extractor,
      content: truncated.text,
      tookMs: Date.now() - startedAt,
      truncated: truncated.truncated,
    };
    writeCache(FETCH_CACHE, cacheKey, payload, params.settings.cacheTtlMs);
    return payload;
  } finally {
    await closeDispatcher(dispatcher);
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
          resource: "knowledge",
        });
      }

      const query = input.query?.trim();
      if (!query) {
        return formatFailure({
          code: "query_required",
          message: "web.search requires a non-empty query string.",
          docs: WEB_DOCS_URL,
          resource: "knowledge",
        });
      }

      if (settings.provider === "brave" && !settings.braveApiKey) {
        return formatFailure({
          code: "missing_brave_api_key",
          message: "web.search (brave) requires BRAVE_API_KEY.",
          docs: WEB_DOCS_URL,
          resource: "knowledge",
        });
      }

      if (settings.provider === "perplexity" && !settings.perplexityApiKey) {
        return formatFailure({
          code: "missing_perplexity_api_key",
          message:
            "web.search (perplexity) requires PERPLEXITY_API_KEY, OPENROUTER_API_KEY, or TOOL_WEB_SEARCH_PERPLEXITY_API_KEY.",
          docs: "https://docs.perplexity.ai/",
          resource: "knowledge",
        });
      }

      const freshnessRaw = input.freshness?.trim();
      if (freshnessRaw && settings.provider !== "brave") {
        return formatFailure({
          code: "unsupported_freshness",
          message: "freshness is only supported by the Brave web.search provider.",
          docs: WEB_DOCS_URL,
          resource: "knowledge",
        });
      }
      const freshness = freshnessRaw ? normalizeFreshness(freshnessRaw) : undefined;
      if (freshnessRaw && !freshness) {
        return formatFailure({
          code: "invalid_freshness",
          message:
            "freshness must be one of pd, pw, pm, py, or a range like YYYY-MM-DDtoYYYY-MM-DD.",
          docs: WEB_DOCS_URL,
          resource: "knowledge",
        });
      }

      try {
        const data = await runWebSearch({
          query,
          count: resolveSearchCount(input.count, settings.maxResults),
          country: parseString(input.country),
          searchLang: parseString(input.search_lang),
          uiLang: parseString(input.ui_lang),
          freshness,
          settings,
        });

        return {
          success: true,
          data,
          message: "Web search completed.",
          meta: {
            resource: "knowledge",
            itemCount:
              typeof data.count === "number"
                ? data.count
                : Array.isArray(data.citations)
                  ? data.citations.length
                  : undefined,
            durationMs: typeof data.tookMs === "number" ? data.tookMs : undefined,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown web.search error";
        env.runtime.logger.warn("web.search failed", {
          provider: settings.provider,
          query: query.slice(0, 120),
          error: message,
        });
        return formatFailure({
          code: "web_search_failed",
          message: "web.search failed while fetching results.",
          detail: message,
          docs: WEB_DOCS_URL,
          resource: "knowledge",
        });
      }
    },

    async fetch(input) {
      const settings = resolveFetchSettings();
      if (!settings.enabled) {
        return formatFailure({
          code: "web_fetch_disabled",
          message: "Web fetch is disabled by runtime configuration.",
          resource: "knowledge",
        });
      }

      const url = input.url?.trim();
      if (!url) {
        return formatFailure({
          code: "url_required",
          message: "web.fetch requires a URL.",
          resource: "knowledge",
        });
      }

      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return formatFailure({
          code: "invalid_url",
          message: "Invalid URL: must be an absolute http/https URL.",
          resource: "knowledge",
        });
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return formatFailure({
          code: "invalid_url_scheme",
          message: "Invalid URL: only http and https are supported.",
          resource: "knowledge",
        });
      }

      const extractMode: ExtractMode = input.extractMode === "text" ? "text" : "markdown";
      const maxChars = Math.max(
        100,
        Math.floor(
          typeof input.maxChars === "number" && Number.isFinite(input.maxChars)
            ? input.maxChars
            : settings.maxChars,
        ),
      );

      if (settings.firecrawl.enabled && !settings.firecrawl.apiKey) {
        return formatFailure({
          code: "missing_firecrawl_api_key",
          message: "Firecrawl fallback is enabled but FIRECRAWL_API_KEY is missing.",
          docs: FIRECRAWL_DOCS_URL,
          resource: "knowledge",
        });
      }

      try {
        const data = await runWebFetch({
          url,
          extractMode,
          maxChars,
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
        if (error instanceof SsrfBlockedError) {
          env.runtime.logger.warn("web.fetch blocked by SSRF guard", {
            url: sanitizeUrlForLog(url),
            error: error.message,
          });
          return formatFailure({
            code: "ssrf_blocked",
            message: "web.fetch blocked the target URL because it appears private or internal.",
            detail: error.message,
            resource: "knowledge",
          });
        }

        const message = error instanceof Error ? error.message : "Unknown web.fetch error";
        env.runtime.logger.warn("web.fetch failed", {
          url: sanitizeUrlForLog(url),
          error: message,
        });
        return formatFailure({
          code: "web_fetch_failed",
          message: "web.fetch failed while retrieving or extracting content.",
          detail: message,
          resource: "knowledge",
        });
      }
    },
  };
}

export const __testing = {
  inferPerplexityBaseUrlFromApiKey,
  resolvePerplexityBaseUrl,
  normalizeFreshness,
  clearCaches: () => {
    clearRuntimeWebCache(SEARCH_CACHE as Map<string, CacheEntry<unknown>>);
    clearRuntimeWebCache(FETCH_CACHE as Map<string, CacheEntry<unknown>>);
  },
} as const;
