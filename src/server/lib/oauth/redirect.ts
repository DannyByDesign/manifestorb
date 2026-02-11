import { NextResponse } from "next/server";
import { env } from "@/env";

type RedirectOptions = {
  allowedOrigin?: string;
  fallbackBaseUrl?: string;
};

/**
 * Custom error class for OAuth redirect responses.
 * Thrown when we need to redirect with an error during OAuth flow.
 */
export class RedirectError extends Error {
  redirectUrl: URL;
  responseHeaders: Headers;

  constructor(redirectUrl: URL, responseHeaders: Headers) {
    super("Redirect required");
    this.name = "RedirectError";
    this.redirectUrl = redirectUrl;
    this.responseHeaders = responseHeaders;
  }
}

/**
 * Validates that a redirect URL belongs to the application's allowed origin.
 * Prevents open redirect attacks where attackers could redirect users to phishing sites.
 */
function isValidRedirectUrl(url: URL, options?: RedirectOptions): boolean {
  try {
    const allowedOrigins = new Set<string>();
    if (env.NEXT_PUBLIC_BASE_URL) {
      allowedOrigins.add(new URL(env.NEXT_PUBLIC_BASE_URL).origin);
    }
    if (options?.allowedOrigin) {
      allowedOrigins.add(new URL(options.allowedOrigin).origin);
    }
    if (allowedOrigins.size === 0) return true;
    return allowedOrigins.has(url.origin);
  } catch {
    return false;
  }
}

/**
 * Gets a safe redirect URL, falling back to /accounts if the provided URL is not allowed.
 */
function getSafeRedirectUrl(
  redirectUrl: URL,
  options?: RedirectOptions,
): URL {
  if (isValidRedirectUrl(redirectUrl, options)) {
    return redirectUrl;
  }
  const fallbackBaseUrl = options?.fallbackBaseUrl || env.NEXT_PUBLIC_BASE_URL;
  if (fallbackBaseUrl) {
    return new URL("/accounts", fallbackBaseUrl);
  }
  // Last-resort fallback to same origin to avoid redirecting to a stale host.
  return new URL("/accounts", redirectUrl.origin);
}

/**
 * Redirect with a success message query param
 */
export function redirectWithMessage(
  redirectUrl: URL,
  message: string,
  responseHeaders: Headers,
  options?: RedirectOptions,
): NextResponse {
  const safeUrl = getSafeRedirectUrl(redirectUrl, options);
  safeUrl.searchParams.set("message", message);
  return NextResponse.redirect(safeUrl, { headers: responseHeaders });
}

/**
 * Redirect with an error query param
 */
export function redirectWithError(
  redirectUrl: URL,
  error: string,
  responseHeaders: Headers,
  options?: RedirectOptions,
): NextResponse {
  const safeUrl = getSafeRedirectUrl(redirectUrl, options);
  safeUrl.searchParams.set("error", error);
  return NextResponse.redirect(safeUrl, { headers: responseHeaders });
}
