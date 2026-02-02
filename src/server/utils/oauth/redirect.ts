import { NextResponse } from "next/server";
import { env } from "@/env";

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
function isValidRedirectUrl(url: URL): boolean {
  try {
    const allowedOrigin = new URL(env.NEXT_PUBLIC_BASE_URL).origin;
    return url.origin === allowedOrigin;
  } catch {
    return false;
  }
}

/**
 * Gets a safe redirect URL, falling back to /accounts if the provided URL is not allowed.
 */
function getSafeRedirectUrl(redirectUrl: URL): URL {
  if (isValidRedirectUrl(redirectUrl)) {
    return redirectUrl;
  }
  // Fall back to safe default if URL is not from allowed origin
  return new URL("/accounts", env.NEXT_PUBLIC_BASE_URL);
}

/**
 * Redirect with a success message query param
 */
export function redirectWithMessage(
  redirectUrl: URL,
  message: string,
  responseHeaders: Headers,
): NextResponse {
  const safeUrl = getSafeRedirectUrl(redirectUrl);
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
): NextResponse {
  const safeUrl = getSafeRedirectUrl(redirectUrl);
  safeUrl.searchParams.set("error", error);
  return NextResponse.redirect(safeUrl, { headers: responseHeaders });
}
