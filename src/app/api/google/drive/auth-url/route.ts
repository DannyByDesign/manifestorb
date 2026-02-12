import { NextResponse } from "next/server";
import { withEmailAccount } from "@/server/lib/middleware";
import { getGoogleDriveOAuth2Url } from "@/features/drive/client";
import { DRIVE_STATE_COOKIE_NAME } from "@/features/drive/constants";
import {
  generateOAuthState,
  oauthStateCookieOptions,
} from "@/server/lib/oauth/state";
import { resolveOAuthBaseUrl } from "@/server/lib/oauth/base-url";

export type GetDriveAuthUrlResponse = { url: string };

export const GET = withEmailAccount(
  "google/drive/auth-url",
  async (request) => {
    const { emailAccountId } = request.auth;
    const { url, state } = getAuthUrl({
      emailAccountId,
      baseUrl: resolveOAuthBaseUrl(request.nextUrl.origin, request.headers),
    });

    const res: GetDriveAuthUrlResponse = { url };
    const response = NextResponse.json(res);

    response.cookies.set(
      DRIVE_STATE_COOKIE_NAME,
      state,
      oauthStateCookieOptions,
    );

    return response;
  },
);

const getAuthUrl = ({
  emailAccountId,
  baseUrl,
}: {
  emailAccountId: string;
  baseUrl: string;
}) => {
  const state = generateOAuthState({
    emailAccountId,
    type: "drive",
  });

  const url = getGoogleDriveOAuth2Url(state, baseUrl);

  return { url, state };
};
