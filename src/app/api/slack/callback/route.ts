import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/env";
import { auth } from "@/server/auth";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { resolveOAuthBaseUrl } from "@/server/lib/oauth/base-url";
import { SLACK_OAUTH_STATE_COOKIE_NAME } from "@/server/integrations/slack/constants";
import {
  decodeSlackState,
  exchangeSlackOAuthCode,
} from "@/server/integrations/slack/oauth";
import { sendSurfaceOnboardingLinked } from "@/server/lib/surfaces-client";
import { randomUUID } from "node:crypto";

const logger = createScopedLogger("slack/callback");

function redirectToConnect(baseUrl: string, reason: string, requestId: string) {
  const url = new URL("/connect", baseUrl);
  url.searchParams.set("error", "connection_failed");
  url.searchParams.set("reason", reason);
  url.searchParams.set("requestId", requestId);
  return NextResponse.redirect(url);
}

export const GET = async (request: NextRequest) => {
  const requestId = request.headers.get("x-request-id") || randomUUID();
  const baseUrl = resolveOAuthBaseUrl(request.nextUrl.origin, request.headers);

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const cookieState =
    request.cookies.get(SLACK_OAUTH_STATE_COOKIE_NAME)?.value ?? null;

  if (!code || !state) {
    logger.warn("Slack callback missing code or state", {
      requestId,
      hasCode: Boolean(code),
      hasState: Boolean(state),
    });
    return redirectToConnect(baseUrl, "missing_code_or_state", requestId);
  }

  if (!cookieState || cookieState !== state) {
    logger.warn("Slack callback state mismatch", {
      requestId,
      hasCookieState: Boolean(cookieState),
      cookieMatches: cookieState === state,
    });
    return redirectToConnect(baseUrl, "state_mismatch", requestId);
  }

  const decoded = decodeSlackState(state);
  if (!decoded.ok) {
    logger.warn("Slack callback state failed to decode", { requestId });
    return redirectToConnect(baseUrl, "invalid_state", requestId);
  }

  const session = await auth();
  if (!session?.user?.id) {
    // Force web login first; preserve the callback querystring so the flow can resume.
    const returnTo = `${request.nextUrl.pathname}?${request.nextUrl.searchParams.toString()}`;
    const loginUrl = new URL("/login", baseUrl);
    loginUrl.searchParams.set("returnTo", returnTo);
    const res = NextResponse.redirect(loginUrl);
    // Keep the cookie so we can validate after login.
    return res;
  }

  if (session.user.id !== decoded.userId) {
    logger.warn("Slack callback user mismatch", {
      requestId,
      sessionUserId: session.user.id,
      stateUserId: decoded.userId,
    });
    return redirectToConnect(baseUrl, "user_mismatch", requestId);
  }

  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    logger.error("Slack OAuth not configured", { requestId });
    return redirectToConnect(baseUrl, "slack_oauth_not_configured", requestId);
  }

  const redirectUri = `${baseUrl.replace(/\/$/, "")}/api/slack/callback`;

  try {
    const exchange = await exchangeSlackOAuthCode({
      clientId: env.SLACK_CLIENT_ID,
      clientSecret: env.SLACK_CLIENT_SECRET,
      code,
      redirectUri,
    });

    if (!exchange.ok) {
      logger.error("Slack OAuth code exchange failed", {
        requestId,
        error: exchange.error,
        errorCode: exchange.errorCode ?? null,
      });
      return redirectToConnect(baseUrl, "oauth_exchange_failed", requestId);
    }

    const providerAccountId = `${exchange.teamId}:${exchange.authedUserId}`;

    const existing = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "slack",
          providerAccountId,
        },
      },
      select: { id: true, userId: true },
    });

    if (existing && existing.userId !== session.user.id) {
      logger.warn("Slack account already linked to different user", {
        requestId,
        providerAccountId,
        existingUserId: existing.userId,
        sessionUserId: session.user.id,
      });
      return redirectToConnect(baseUrl, "already_linked", requestId);
    }

    if (!existing) {
      await prisma.account.create({
        data: {
          userId: session.user.id,
          provider: "slack",
          providerAccountId,
          type: "oauth",
        },
      });
    }

    // Tell the surfaces sidecar to DM the user (and open the DM channel).
    const linkedResult = await sendSurfaceOnboardingLinked({
      provider: "slack",
      providerAccountId,
      providerTeamId: exchange.teamId,
    });

    const channelId =
      linkedResult && "ok" in linkedResult && linkedResult.ok
        ? linkedResult.channelId ?? null
        : null;

    const res = channelId
      ? NextResponse.redirect(
          `https://slack.com/app_redirect?team=${encodeURIComponent(exchange.teamId)}&channel=${encodeURIComponent(channelId)}`,
        )
      : NextResponse.redirect(
          `https://slack.com/app_redirect?team=${encodeURIComponent(exchange.teamId)}`,
        );

    res.cookies.set(SLACK_OAUTH_STATE_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/api/slack",
      maxAge: 0,
    });
    return res;
  } catch (error) {
    logger.error("Unhandled error in Slack callback", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return redirectToConnect(baseUrl, "internal_error", requestId);
  }
};
