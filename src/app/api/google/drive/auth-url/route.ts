import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import prisma from "@/server/db/client";
import { withError } from "@/server/lib/middleware";
import { EMAIL_ACCOUNT_HEADER } from "@/server/lib/config";
import { DRIVE_STATE_COOKIE_NAME } from "@/features/drive/constants";
import {
  generateOAuthState,
  oauthStateCookieOptions,
} from "@/server/lib/oauth/state";
import { resolveOAuthBaseUrl } from "@/server/lib/oauth/base-url";
import { generateGoogleOAuthUrl } from "@/server/lib/oauth/google-connect";

export type GetDriveAuthUrlResponse = { url: string };

async function resolveEmailAccountId(
  userId: string,
  requestedId: string | null,
): Promise<string | null> {
  if (requestedId) {
    const match = await prisma.emailAccount.findFirst({
      where: { id: requestedId, userId },
      select: { id: true },
    });
    if (match) return match.id;
  }

  const fallback = await prisma.emailAccount.findFirst({
    where: { userId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return fallback?.id ?? null;
}

export const GET = withError("google/drive/auth-url", async (request) => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized", isKnownError: true },
      { status: 401 },
    );
  }

  const requestedEmailAccountId = request.headers.get(EMAIL_ACCOUNT_HEADER);
  const emailAccountId = await resolveEmailAccountId(
    userId,
    requestedEmailAccountId,
  );

  if (!emailAccountId) {
    return NextResponse.json(
      { error: "Connect Gmail first before connecting Drive." },
      { status: 400 },
    );
  }

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
});

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

  const url = generateGoogleOAuthUrl({
    kind: "drive",
    baseUrl,
    state,
  });

  return { url, state };
};
