import { NextResponse } from "next/server";
import { withEmailAccount } from "@/server/lib/middleware";
import { getGoogleDriveOAuth2Url } from "@/features/drive/client";
import { DRIVE_STATE_COOKIE_NAME } from "@/features/drive/constants";
import {
  generateOAuthState,
  oauthStateCookieOptions,
} from "@/server/lib/oauth/state";

export type GetDriveAuthUrlResponse = { url: string };

export const GET = withEmailAccount(
  "google/drive/auth-url",
  async (request) => {
    const { emailAccountId } = request.auth;
    const { url, state } = getAuthUrl({ emailAccountId });

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

const getAuthUrl = ({ emailAccountId }: { emailAccountId: string }) => {
  const state = generateOAuthState({
    emailAccountId,
    type: "drive",
  });

  const url = getGoogleDriveOAuth2Url(state);

  return { url, state };
};
