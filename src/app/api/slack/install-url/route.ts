import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { env } from "@/env";
import { resolveOAuthBaseUrl } from "@/server/lib/oauth/base-url";
import { withError } from "@/server/lib/middleware";
import { SLACK_OAUTH_STATE_COOKIE_NAME } from "@/server/integrations/slack/constants";
import { generateSlackOAuthState } from "@/server/integrations/slack/oauth";

const SLACK_BOT_SCOPES = [
  "chat:write",
  "im:write",
  "app_home:read",
].join(",");

export const GET = withError("slack/install-url", async (request) => {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized", isKnownError: true },
      { status: 401 },
    );
  }

  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    return NextResponse.json(
      {
        error:
          "Slack OAuth is not configured. Missing SLACK_CLIENT_ID/SLACK_CLIENT_SECRET.",
        isKnownError: true,
      },
      { status: 500 },
    );
  }

  const baseUrl = resolveOAuthBaseUrl(request.nextUrl.origin, request.headers);
  const redirectUri = `${baseUrl.replace(/\/$/, "")}/api/slack/callback`;
  const { state } = generateSlackOAuthState(session.user.id);

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", env.SLACK_CLIENT_ID);
  url.searchParams.set("scope", SLACK_BOT_SCOPES);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);

  const res = NextResponse.json({ url: url.toString() });
  res.cookies.set(SLACK_OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/api/slack",
    maxAge: 10 * 60, // 10 minutes
  });
  return res;
});

