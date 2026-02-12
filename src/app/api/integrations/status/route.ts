import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { withError } from "@/server/lib/middleware";
import { resolveOAuthBaseUrl } from "@/server/lib/oauth/base-url";
import { getIntegrationStatusForUser } from "@/server/features/integrations/status";

export const GET = withError("integrations/status", async (request) => {
  const session = await auth();

  if (!session?.user?.id) {
    const baseUrl = resolveOAuthBaseUrl(request.nextUrl.origin, request.headers);
    return NextResponse.json({
      authenticated: false,
      oauth: {
        baseUrl: baseUrl.replace(/\/$/, ""),
      },
    });
  }

  const baseUrl = resolveOAuthBaseUrl(request.nextUrl.origin, request.headers);
  const status = await getIntegrationStatusForUser(
    session.user.id,
    session.user,
    baseUrl,
  );

  return NextResponse.json(status);
});

