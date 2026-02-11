import type { NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import type { CalendarOAuthProvider } from "./oauth-types";
import {
  validateOAuthCallback,
  parseAndValidateCalendarState,
  buildCalendarRedirectUrl,
  checkExistingConnection,
  createCalendarConnection,
} from "./oauth-callback-helpers";
import {
  RedirectError,
  redirectWithMessage,
  redirectWithError,
} from "@/server/lib/oauth/redirect";
import { verifyEmailAccountAccess } from "@/server/lib/oauth/verify";
import {
  acquireOAuthCodeLock,
  getOAuthCodeResult,
  setOAuthCodeResult,
  clearOAuthCode,
} from "@/server/lib/redis/oauth-code";
import { CALENDAR_STATE_COOKIE_NAME } from "./constants";

/**
 * Unified handler for calendar OAuth callbacks
 */
export async function handleCalendarCallback(
  request: NextRequest,
  provider: CalendarOAuthProvider,
  logger: Logger,
): Promise<NextResponse> {
  let redirectHeaders = new Headers();
  const baseUrl = request.nextUrl.origin;

  try {
    // Step 1: Validate OAuth callback parameters
    const { code, redirectUrl, response } = await validateOAuthCallback(
      request,
      logger,
      baseUrl,
    );
    redirectHeaders = response.headers;

    // Step 1.5: Check for duplicate OAuth code processing
    const cachedResult = await getOAuthCodeResult(code);
    if (cachedResult) {
      logger.info("OAuth code already processed, returning cached result");
      const cachedRedirectUrl = new URL("/connect", baseUrl);
      for (const [key, value] of Object.entries(cachedResult.params)) {
        cachedRedirectUrl.searchParams.set(key, value);
      }
      response.cookies.delete(CALENDAR_STATE_COOKIE_NAME);
      return redirectWithMessage(
        cachedRedirectUrl,
        cachedResult.params.message || "calendar_connected",
        redirectHeaders,
        { allowedOrigin: baseUrl, fallbackBaseUrl: baseUrl },
      );
    }

    const acquiredLock = await acquireOAuthCodeLock(code);
    if (!acquiredLock) {
      logger.info("OAuth code is being processed by another request");
      const lockRedirectUrl = new URL("/connect", baseUrl);
      response.cookies.delete(CALENDAR_STATE_COOKIE_NAME);
      return redirectWithMessage(
        lockRedirectUrl,
        "processing",
        redirectHeaders,
        { allowedOrigin: baseUrl, fallbackBaseUrl: baseUrl },
      );
    }

    // The validated state is in the request query params (already validated by validateOAuthCallback)
    const receivedState = request.nextUrl.searchParams.get("state");
    if (!receivedState) {
      throw new Error("Missing validated state");
    }

    // Step 2: Parse and validate the OAuth state
    const decodedState = parseAndValidateCalendarState(
      receivedState,
      logger,
      redirectUrl,
      response.headers,
    );

    const { emailAccountId } = decodedState;

    // Step 3: Update redirect URL to include emailAccountId
    const finalRedirectUrl = buildCalendarRedirectUrl(emailAccountId, baseUrl);

    // Step 4: Verify user owns this email account
    await verifyEmailAccountAccess(
      emailAccountId,
      logger,
      finalRedirectUrl,
      response.headers,
    );

    // Step 5: Exchange code for tokens and get email
    const { accessToken, refreshToken, expiresAt, email } =
      await provider.exchangeCodeForTokens(code);

    // Step 6: Check if connection already exists
    const existingConnection = await checkExistingConnection(
      emailAccountId,
      provider.name,
      email,
    );

    if (existingConnection) {
      logger.info("Calendar connection already exists, updating tokens", {
        emailAccountId,
        email,
        provider: provider.name,
      });

      // Update tokens so re-authorisation refreshes scopes
      await prisma.calendarConnection.update({
        where: { id: existingConnection.id },
        data: {
          accessToken,
          refreshToken,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        },
      });

      // Cache the result for duplicate requests
      await setOAuthCodeResult(code, { message: "calendar_already_connected" });
      return redirectWithMessage(
        finalRedirectUrl,
        "calendar_already_connected",
        redirectHeaders,
        { allowedOrigin: baseUrl, fallbackBaseUrl: baseUrl },
      );
    }

    // Step 7: Create calendar connection
    const connection = await createCalendarConnection({
      provider: provider.name,
      email,
      emailAccountId,
      accessToken,
      refreshToken,
      expiresAt,
    });

    // Step 8: Sync calendars
    await provider.syncCalendars(
      connection.id,
      accessToken,
      refreshToken,
      emailAccountId,
      expiresAt,
    );

    logger.info("Calendar connected successfully", {
      emailAccountId,
      email,
      provider: provider.name,
      connectionId: connection.id,
    });

    // Cache the successful result
    await setOAuthCodeResult(code, { message: "calendar_connected" });

    return redirectWithMessage(
      finalRedirectUrl,
      "calendar_connected",
      redirectHeaders,
      { allowedOrigin: baseUrl, fallbackBaseUrl: baseUrl },
    );
  } catch (error) {
    // Clear the OAuth code lock on error
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    if (code) {
      await clearOAuthCode(code);
    }
    // Handle redirect errors
    if (error instanceof RedirectError) {
      return redirectWithError(
        error.redirectUrl,
        "connection_failed",
        error.responseHeaders,
        { allowedOrigin: baseUrl, fallbackBaseUrl: baseUrl },
      );
    }

    // Handle all other errors
    logger.error("Error in calendar callback", { error });

    // Try to build a redirect URL, fallback to /calendars
    const errorRedirectUrl = new URL("/connect", baseUrl);
    return redirectWithError(
      errorRedirectUrl,
      "connection_failed",
      redirectHeaders,
      { allowedOrigin: baseUrl, fallbackBaseUrl: baseUrl },
    );
  }
}
