import { NextResponse } from "next/server";
import { env } from "@/env";
import type { Logger } from "@/server/lib/logger";
import { parseOAuthState } from "@/server/lib/oauth/state";
import crypto from "node:crypto";

interface ValidateCallbackParams {
  code: string | null;
  receivedState: string | null;
  storedState: string | undefined;
  stateCookieName: string;
  logger: Logger;
  baseUrl?: string;
}

type ValidationResult =
  | {
      success: true;
      targetUserId: string;
      code: string;
    }
  | {
      success: false;
      response: NextResponse;
    };

/**
 * Performs a constant-time comparison of two strings to prevent timing attacks.
 * Uses crypto.timingSafeEqual to avoid leaking information about the stored state.
 */
function timingSafeCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, 'utf8');
  const bBuffer = Buffer.from(b, 'utf8');
  
  // If lengths differ, we still need to do a comparison to maintain constant time
  // We compare against itself to avoid early return
  if (aBuffer.length !== bBuffer.length) {
    // Compare a with itself to maintain timing consistency
    crypto.timingSafeEqual(aBuffer, aBuffer);
    return false;
  }
  
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function validateOAuthCallback({
  code,
  receivedState,
  storedState,
  stateCookieName,
  logger,
  baseUrl,
}: ValidateCallbackParams): ValidationResult {
  const resolvedBaseUrl = baseUrl?.trim() || env.NEXT_PUBLIC_BASE_URL;
  const redirectUrl = new URL("/accounts", resolvedBaseUrl);
  const response = NextResponse.redirect(redirectUrl);

  // Separate null checks from comparison to use timing-safe comparison
  if (!storedState || !receivedState) {
    logger.warn("Missing state during OAuth callback", {
      hasReceivedState: !!receivedState,
      hasStoredState: !!storedState,
    });
    redirectUrl.searchParams.set("error", "invalid_state");
    response.cookies.delete(stateCookieName);
    return {
      success: false,
      response: NextResponse.redirect(redirectUrl, {
        headers: response.headers,
      }),
    };
  }

  // Use constant-time comparison to prevent timing attacks
  if (!timingSafeCompare(storedState, receivedState)) {
    logger.warn("Invalid state during OAuth callback", {
      receivedState,
      hasStoredState: !!storedState,
    });
    redirectUrl.searchParams.set("error", "invalid_state");
    response.cookies.delete(stateCookieName);
    return {
      success: false,
      response: NextResponse.redirect(redirectUrl, {
        headers: response.headers,
      }),
    };
  }

  let decodedState: {
    userId: string;
    nonce: string;
  };
  try {
    decodedState = parseOAuthState(storedState);
  } catch (error) {
    logger.error("Failed to decode state", { error });
    redirectUrl.searchParams.set("error", "invalid_state_format");
    response.cookies.delete(stateCookieName);
    return {
      success: false,
      response: NextResponse.redirect(redirectUrl, {
        headers: response.headers,
      }),
    };
  }

  if (!code) {
    logger.warn("Missing code in OAuth callback");
    redirectUrl.searchParams.set("error", "missing_code");
    response.cookies.delete(stateCookieName);
    return {
      success: false,
      response: NextResponse.redirect(redirectUrl, {
        headers: response.headers,
      }),
    };
  }

  return {
    success: true,
    targetUserId: decodedState.userId,
    code,
  };
}
