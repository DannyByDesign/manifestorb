import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/server/db/client";
import { CALENDAR_STATE_COOKIE_NAME } from "@/features/calendar/constants";
import { parseOAuthState } from "@/server/lib/oauth/state";
import type { Logger } from "@/server/lib/logger";
import type {
  OAuthCallbackValidation,
  CalendarOAuthState,
} from "./oauth-types";

import { createHash, timingSafeEqual } from "node:crypto";

import { RedirectError } from "@/server/lib/oauth/redirect";

const calendarOAuthStateSchema = z.object({
  emailAccountId: z.string().min(1).max(64),
  type: z.literal("calendar"),
  nonce: z.string().min(8).max(128),
});

/**
 * Validate OAuth callback parameters and setup redirect
 */
export async function validateOAuthCallback(
  request: NextRequest,
  logger: Logger,
  baseUrl: string,
): Promise<OAuthCallbackValidation> {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const receivedState = searchParams.get("state");
  const storedState = request.cookies.get(CALENDAR_STATE_COOKIE_NAME)?.value;

  const redirectUrl = new URL("/connect", baseUrl);
  const response = NextResponse.redirect(redirectUrl);

  response.cookies.delete(CALENDAR_STATE_COOKIE_NAME);

  logger.info("Calendar OAuth callback received", {
    hasCode: !!code,
    hasReceivedState: !!receivedState,
    hasStoredState: !!storedState,
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
  });

  if (!code || code.length < 10) {
    logger.warn("Missing or invalid code in calendar callback");
    redirectUrl.searchParams.set("error", "missing_code");
    throw new RedirectError(redirectUrl, response.headers);
  }

  const stateHash = (value?: string | null) => {
    if (!value) return null;
    return createHash("sha256").update(value).digest("hex").slice(0, 10);
  };

  const stateMatches = (() => {
    if (!storedState || !receivedState) return false;
    const a = Buffer.from(storedState, "utf8");
    const b = Buffer.from(receivedState, "utf8");
    if (a.length !== b.length) {
      // Maintain constant-time-ish behavior even on mismatched lengths.
      try {
        timingSafeEqual(a, a);
      } catch {
        // ignore
      }
      return false;
    }
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  })();

  if (!stateMatches) {
    logger.warn("Invalid state during calendar callback", {
      hasStoredState: !!storedState,
      hasReceivedState: !!receivedState,
      storedStateHash: stateHash(storedState),
      receivedStateHash: stateHash(receivedState),
    });
    redirectUrl.searchParams.set("error", "invalid_state");
    throw new RedirectError(redirectUrl, response.headers);
  }

  return { code, redirectUrl, response };
}

/**
 * Parse and validate the OAuth state
 */
export function parseAndValidateCalendarState(
  storedState: string,
  logger: Logger,
  redirectUrl: URL,
  responseHeaders: Headers,
): CalendarOAuthState {
  let rawState: unknown;
  try {
    rawState = parseOAuthState<Omit<CalendarOAuthState, "nonce">>(storedState);
  } catch (error) {
    logger.error("Failed to decode state", { error });
    redirectUrl.searchParams.set("error", "invalid_state_format");
    throw new RedirectError(redirectUrl, responseHeaders);
  }

  const validationResult = calendarOAuthStateSchema.safeParse(rawState);
  if (!validationResult.success) {
    logger.error("State validation failed", {
      errors: validationResult.error.issues,
    });
    redirectUrl.searchParams.set("error", "invalid_state_format");
    throw new RedirectError(redirectUrl, responseHeaders);
  }

  return validationResult.data;
}

/**
 * Build redirect URL with emailAccountId
 */
export function buildCalendarRedirectUrl(
  _emailAccountId: string,
  baseUrl: string,
): URL {
  return new URL("/connect", baseUrl);
}

/**
 * Check if calendar connection already exists
 */
export async function checkExistingConnection(
  emailAccountId: string,
  provider: "google" | "microsoft",
  email: string,
) {
  return await prisma.calendarConnection.findFirst({
    where: {
      emailAccountId,
      provider,
      email,
    },
  });
}

/**
 * Create a calendar connection record
 */
export async function createCalendarConnection(params: {
  provider: "google" | "microsoft";
  email: string;
  emailAccountId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
}) {
  return await prisma.calendarConnection.create({
    data: {
      provider: params.provider,
      email: params.email,
      emailAccountId: params.emailAccountId,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      expiresAt: params.expiresAt,
      isConnected: true,
    },
  });
}
