import { env } from "@/env";

const LOCAL_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i;

function normalizeToOrigin(value: string): string {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return new URL(withProtocol).origin;
}

export function resolveOAuthBaseUrl(requestOrigin: string): string {
  const origin = normalizeToOrigin(requestOrigin);
  const appOrigin = normalizeToOrigin(env.NEXT_PUBLIC_BASE_URL);

  if (env.NODE_ENV === "production" && LOCAL_ORIGIN_RE.test(origin)) {
    return appOrigin;
  }

  return origin;
}

