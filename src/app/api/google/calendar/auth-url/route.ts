import { NextResponse } from "next/server";
import { withEmailAccount } from "@/server/lib/middleware";
import { getCalendarOAuth2ClientForBaseUrl } from "@/features/calendar/client";
import { CALENDAR_STATE_COOKIE_NAME } from "@/features/calendar/constants";
import { CALENDAR_SCOPES } from "@/server/integrations/google/scopes";
import {
  generateOAuthState,
  oauthStateCookieOptions,
} from "@/server/lib/oauth/state";
import { resolveOAuthBaseUrl } from "@/server/lib/oauth/base-url";

export type GetCalendarAuthUrlResponse = { url: string };

const getAuthUrl = ({
  emailAccountId,
  baseUrl,
}: {
  emailAccountId: string;
  baseUrl: string;
}) => {
  const oauth2Client = getCalendarOAuth2ClientForBaseUrl(baseUrl);

  const state = generateOAuthState({
    emailAccountId,
    type: "calendar",
  });

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: CALENDAR_SCOPES,
    state,
    prompt: "consent",
  });

  return { url, state };
};

export const GET = withEmailAccount(
  "google/calendar/auth-url",
  async (request) => {
    const { emailAccountId } = request.auth;
    const { url, state } = getAuthUrl({
      emailAccountId,
      baseUrl: resolveOAuthBaseUrl(request.nextUrl.origin),
    });

    const res: GetCalendarAuthUrlResponse = { url };
    const response = NextResponse.json(res);

    response.cookies.set(
      CALENDAR_STATE_COOKIE_NAME,
      state,
      oauthStateCookieOptions,
    );

    return response;
  },
);
