import { NextResponse } from "next/server";
import { withError } from "@/server/lib/middleware";
import { auth } from "@/server/auth";
import { GOOGLE_LINKING_STATE_COOKIE_NAME } from "@/server/integrations/google/constants";
import {
  generateOAuthState,
  oauthStateCookieOptions,
} from "@/server/lib/oauth/state";
import { resolveOAuthBaseUrl } from "@/server/lib/oauth/base-url";
import { generateGoogleOAuthUrl } from "@/server/lib/oauth/google-connect";

export type GetAuthLinkUrlResponse = { url: string };

const getAuthUrl = ({
  userId,
  baseUrl,
}: {
  userId: string;
  baseUrl: string;
}) => {
  const state = generateOAuthState({ userId });
  const url = generateGoogleOAuthUrl({
    kind: "gmail",
    baseUrl,
    state,
  });

  return { url, state };
};

export const GET = withError("google/linking/auth-url", async (request) => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized", isKnownError: true },
      { status: 401 },
    );
  }

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
