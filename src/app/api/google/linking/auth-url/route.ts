import { NextResponse } from "next/server";
import { withAuth } from "@/server/lib/middleware";
import { getLinkingOAuth2ClientForBaseUrl } from "@/server/integrations/google/client";
import { GOOGLE_LINKING_STATE_COOKIE_NAME } from "@/server/integrations/google/constants";
import { SCOPES } from "@/server/integrations/google/scopes";
import {
  generateOAuthState,
  oauthStateCookieOptions,
} from "@/server/lib/oauth/state";
import { resolveOAuthBaseUrl } from "@/server/lib/oauth/base-url";

export type GetAuthLinkUrlResponse = { url: string };

const getAuthUrl = ({
  userId,
  baseUrl,
}: {
  userId: string;
  baseUrl: string;
}) => {
  const googleAuth = getLinkingOAuth2ClientForBaseUrl(baseUrl);

  const state = generateOAuthState({ userId });

  const url = googleAuth.generateAuthUrl({
    access_type: "offline",
    scope: [...new Set([...SCOPES, "openid", "email"])].join(" "),
    prompt: "consent",
    state,
  });

  return { url, state };
};

export const GET = withAuth("google/linking/auth-url", async (request) => {
  const userId = request.auth.userId;
  const baseUrl = resolveOAuthBaseUrl(request.nextUrl.origin, request.headers);
  request.logger?.info?.("Generating Gmail linking auth URL", {
    userId,
    baseUrl,
  });
  const { url: authUrl, state } = getAuthUrl({
    userId,
    baseUrl,
  });

  const response = NextResponse.json({ url: authUrl });

  response.cookies.set(
    GOOGLE_LINKING_STATE_COOKIE_NAME,
    state,
    oauthStateCookieOptions,
  );

  return response;
});
