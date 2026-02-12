const LOCAL_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i;

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeToOrigin(value?: string | null): string | null {
  if (!value) return null;
  const unquoted = stripWrappingQuotes(value);
  if (!unquoted) return null;

  const withProtocol = /^https?:\/\//i.test(unquoted)
    ? unquoted
    : `https://${unquoted}`;

  try {
    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
}

function getForwardedOrigin(headers?: Headers): string | null {
  if (!headers) return null;

  const forwardedHost = headers.get("x-forwarded-host");
  if (!forwardedHost) return null;
  const forwardedProto = headers.get("x-forwarded-proto") || "https";

  // Some proxies provide comma-separated values; use the first hop.
  const host = forwardedHost.split(",")[0]?.trim();
  const proto = forwardedProto.split(",")[0]?.trim();
  if (!host || !proto) return null;

  return normalizeToOrigin(`${proto}://${host}`);
}

function isUsableOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  if (process.env.NODE_ENV !== "production") return true;
  return !LOCAL_ORIGIN_RE.test(origin);
}

export function resolveOAuthBaseUrl(
  requestOrigin: string,
  headers?: Headers,
): string {
  const forwardedOrigin = getForwardedOrigin(headers);
  const origin = normalizeToOrigin(requestOrigin);
  const appOrigin = normalizeToOrigin(process.env.NEXT_PUBLIC_BASE_URL);

  if (isUsableOrigin(forwardedOrigin)) return forwardedOrigin;
  if (isUsableOrigin(origin)) return origin;
  if (isUsableOrigin(appOrigin)) return appOrigin;

  // Final fallback to avoid a hard 500 for malformed base URL config.
  // Route handlers will still fail later if provider rejects the redirect URI.
  return forwardedOrigin || origin || appOrigin || requestOrigin;

}
